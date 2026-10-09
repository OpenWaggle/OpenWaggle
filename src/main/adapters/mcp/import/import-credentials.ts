/**
 * Credentials written into another tool's command line or URL. Pi passes arguments and URLs as
 * written and never resolves `${NAME}` or `!command` in them, so a credential there would reach
 * OpenWaggle's file in plaintext. Where the server can read an environment variable instead
 * (Docker's `-e NAME`, mcp-remote's `--header Name:${VAR}`), the value becomes a vault secret in
 * `env`; everywhere else it is dropped, with its flag. A warning never repeats the value.
 */
import path from 'node:path'
import type { ImportedCredential, ImportValueContext } from './import-values'
import { sourceVariablePattern } from './import-variables'

/** Last words that make a flag, variable, or header name a credential. */
const CREDENTIAL_WORDS = new Set([
  'key',
  'apikey',
  'token',
  'secret',
  'password',
  'passwd',
  'credential',
  'credentials',
  'authorization',
  'cookie',
  'bearer',
  'pat',
])
const WORD_BOUNDARY = /[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])/

/**
 * Whether a name holds a credential, by its last whole word: `--api-key`, `GITHUB_TOKEN`,
 * `OPENAI_KEY`, `Authorization`, but not `--max-tokens`, `--token-limit`, or `--credentials-file`.
 */
export function isCredentialName(name: string) {
  const last = name.split(WORD_BOUNDARY).filter(Boolean).at(-1)
  return last !== undefined && CREDENTIAL_WORDS.has(last.toLowerCase())
}

const CONTAINER_COMMANDS = new Set(['docker', 'podman'])
const MCP_REMOTE = 'mcp-remote'
const ENV_FLAGS = new Set(['-e', '--env'])
const HEADER_LINE = /^([^:\s]+)\s*:\s*(.+)$/

function environmentName(name: string) {
  return name.replace(/[^A-Za-z0-9_]+/g, '_').toUpperCase()
}

function commandName(command: string | undefined) {
  return command ? path.basename(command).toLowerCase() : ''
}

/** A whole-value variable reference in the syntax the source tool expands, kept with a warning. */
function isSourceVariable(value: string, context: ImportValueContext) {
  const pattern = sourceVariablePattern(context.source)
  if (!pattern) return false
  const match = new RegExp(pattern.source).exec(value)
  return match?.index === 0 && match[0].length === value.length
}

function warnDropped(location: string, context: ImportValueContext) {
  context.warnings.push(
    `A command-line credential in ${location} was not imported, with its flag. Move it to the encrypted vault or an environment variable.`,
  )
}

/** `https://user:pw@host/?api_key=…` without the userinfo and credential query parameters. */
export function urlWithoutCredentials(
  value: string,
  location: string,
  context: ImportValueContext,
) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return value
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:' && !url.protocol.startsWith('ws')) {
    return value
  }
  const removed: string[] = []
  if (url.username || url.password) {
    url.username = ''
    url.password = ''
    removed.push('its user name and password')
  }
  for (const key of [...url.searchParams.keys()]) {
    if (!isCredentialName(key)) continue
    url.searchParams.delete(key)
    removed.push(`query parameter ${key}`)
  }
  if (removed.length === 0) return value
  context.warnings.push(
    `${location} had a credential in ${removed.join(' and ')}, which was not imported. If the server needs it, add it as a header with a vault secret.`,
  )
  return url.toString()
}

/** The vault-backed or converted value an argument's credential gets in the entry's `env`. */
export type ImportedEnvValue = (name: string, value: string) => ImportedCredential | undefined

interface ArgumentState {
  readonly args: string[]
  readonly env: Record<string, ImportedCredential>
  readonly container: boolean
  readonly remote: boolean
  readonly context: ImportValueContext
  readonly literal: (value: string) => string
  readonly envValue: ImportedEnvValue
  readonly secretName: (field: string) => string
}

/**
 * A flag and its value as written: `--flag value`, `--flag=value`, or attached to a short flag
 * (`-eNAME=VALUE`, `-HName: value`). `emit` writes a value back the same way.
 */
interface FlagValue {
  readonly flag: string
  readonly value: string
  readonly consumed: number
  readonly emit: (value: string) => readonly string[]
}

/** Short flags whose value can follow them directly. */
const ATTACHED_SHORT_FLAGS: Readonly<
  Record<string, (value: string, state: ArgumentState) => boolean>
> = {
  '-e': (value, state) => state.container && value.includes('='),
  '-H': (value) => HEADER_LINE.test(value),
}
const SHORT_FLAG_LENGTH = 2

function attachedShortFlag(token: string, state: ArgumentState): FlagValue | undefined {
  const flag = token.slice(0, SHORT_FLAG_LENGTH)
  const value = token.slice(SHORT_FLAG_LENGTH)
  const accepts = token.startsWith('--') ? undefined : ATTACHED_SHORT_FLAGS[flag]
  if (!accepts || !value || !accepts(value, state)) return undefined
  return { flag, value, consumed: 1, emit: (next) => [`${flag}${next}`] }
}

function flagValueAt(values: readonly string[], index: number, state: ArgumentState) {
  const token = values[index] ?? ''
  if (!token.startsWith('-') || token === '-' || token === '--') return undefined
  const attached = attachedShortFlag(token, state)
  if (attached) return attached
  const separator = token.indexOf('=')
  if (separator > 1) {
    const flag = token.slice(0, separator)
    return {
      flag,
      value: token.slice(separator + 1),
      consumed: 1,
      emit: (next: string) => [`${flag}=${next}`],
    } satisfies FlagValue
  }
  const next = values[index + 1]
  if (next === undefined || next.startsWith('-')) return undefined
  return {
    flag: token,
    value: next,
    consumed: FLAG_AND_VALUE,
    emit: (value: string) => [token, value],
  } satisfies FlagValue
}

/** A flag and the value after it. */
const FLAG_AND_VALUE = 2
const HEADER_FLAGS = new Set(['--header', '-H'])
const VARIABLE_REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g

/** Handles a flag's value if it carries a credential; returns whether it did. */
type ArgumentRule = (argument: FlagValue, state: ArgumentState) => boolean

function headerName(value: string) {
  return HEADER_LINE.exec(value)?.[1]
}

/**
 * Docker's `-e NAME=VALUE` with a credential, in any form: `-e NAME`, with NAME in the entry's
 * `env` as a vault secret, or as the variable the source tool would have filled in.
 */
const containerEnvironment: ArgumentRule = (argument, state) => {
  if (!state.container || !ENV_FLAGS.has(argument.flag)) return false
  const separator = argument.value.indexOf('=')
  const name = argument.value.slice(0, separator)
  if (separator <= 0 || !isCredentialName(name)) return false
  const value = state.envValue(name, argument.value.slice(separator + 1))
  state.args.push(...argument.emit(name))
  if (value !== undefined) state.env[name] = value
  return true
}

/**
 * A credential header (`--header`, `-H`). mcp-remote expands `${VAR}` in a header: one that
 * already reads a variable is kept, and the variable is a credential; a plaintext one reads a new
 * vault secret as `Name:${NAME}`. For other commands the header is dropped.
 */
const credentialHeader: ArgumentRule = (argument, state) => {
  const header = HEADER_FLAGS.has(argument.flag) ? headerName(argument.value) : undefined
  if (!header || !isCredentialName(header)) return false
  if (!state.remote) {
    warnDropped(argument.flag, state.context)
    return true
  }
  const variables = [...argument.value.matchAll(VARIABLE_REFERENCE)].map((match) => match[1] ?? '')
  if (variables.length > 0) {
    for (const variable of variables) state.context.credentialEnvNames.add(variable)
    state.args.push(...argument.emit(argument.value))
    return true
  }
  const variable = environmentName(header)
  state.args.push(...argument.emit(`${header}:\${${variable}}`))
  state.env[variable] = { secret: variable }
  state.context.warnings.push(
    `The ${header} header in args was not imported; mcp-remote reads it from ${state.secretName(variable)}, which you fill in after importing.`,
  )
  return true
}

/** `--api-key value` or `--api-key=value`, dropped with its flag unless the source expands it. */
const credentialFlag: ArgumentRule = (argument, state) => {
  if (!isCredentialName(argument.flag)) return false
  if (isSourceVariable(argument.value, state.context)) {
    state.args.push(...argument.emit(argument.value).map(state.literal))
  } else warnDropped(argument.consumed === 1 ? `${argument.flag}=…` : argument.flag, state.context)
  return true
}

const ARGUMENT_RULES: readonly ArgumentRule[] = [
  containerEnvironment,
  credentialHeader,
  credentialFlag,
]

/** `mcp-remote`, also as `mcp-remote@latest` or a path to it. */
function isMcpRemote(value: string) {
  return commandName(value).replace(/@[^@/]*$/, '') === MCP_REMOTE
}

/**
 * Arguments as Pi will pass them, without a credential flag's value or the flag itself, plus the
 * environment that replaces a credential where the server reads one. The variables a kept
 * mcp-remote header reads are added to `context.credentialEnvNames`.
 */
export function portableArguments(
  values: readonly string[],
  command: string | undefined,
  context: ImportValueContext,
  literal: (value: string) => string,
  envValue: ImportedEnvValue,
  secretName: (field: string) => string,
) {
  const state: ArgumentState = {
    args: [],
    env: {},
    container: CONTAINER_COMMANDS.has(commandName(command)),
    remote: values.some(isMcpRemote),
    context,
    literal,
    envValue,
    secretName,
  }
  let index = 0
  while (index < values.length) {
    const argument = flagValueAt(values, index, state)
    if (argument && ARGUMENT_RULES.some((rule) => rule(argument, state))) {
      index += argument.consumed
      continue
    }
    state.args.push(urlWithoutCredentials(literal(values[index] ?? ''), 'args', context))
    index += 1
  }
  return { args: state.args, env: state.env }
}
