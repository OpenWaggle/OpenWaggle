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
const HEADER_FLAG = '--header'
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

interface ArgumentState {
  readonly args: string[]
  readonly env: Record<string, ImportedCredential>
  readonly container: boolean
  readonly remote: boolean
  readonly context: ImportValueContext
  readonly literal: (value: string) => string
}

/** Handles the argument at the cursor if it carries a credential; returns how many it consumed. */
/** A flag and the value after it. */
const FLAG_AND_VALUE = 2

type ArgumentRule = (value: string, next: string | undefined, state: ArgumentState) => number

function headerName(value: string) {
  return HEADER_LINE.exec(value)?.[1]
}

/** Docker's `-e NAME=VALUE` with a credential: `-e NAME`, reading NAME from a vault secret. */
const containerEnvironment: ArgumentRule = (value, next, state) => {
  if (!state.container || !ENV_FLAGS.has(value) || next === undefined) return 0
  const separator = next.indexOf('=')
  const name = next.slice(0, separator)
  if (separator <= 0 || !isCredentialName(name)) return 0
  state.args.push(value, name)
  state.env[name] = { secret: name }
  return FLAG_AND_VALUE
}

/**
 * `--header 'Name: value'` with a credential. mcp-remote expands `${VAR}` in a header, so it reads
 * a vault secret as `Name:${NAME}`; for other commands the header is dropped.
 */
const credentialHeader: ArgumentRule = (value, next, state) => {
  const header = value === HEADER_FLAG && next !== undefined ? headerName(next) : undefined
  if (!header || !isCredentialName(header)) return 0
  if (!state.remote) {
    warnDropped(HEADER_FLAG, state.context)
    return FLAG_AND_VALUE
  }
  const variable = environmentName(header)
  state.args.push(HEADER_FLAG, `${header}:\${${variable}}`)
  state.env[variable] = { secret: variable }
  return FLAG_AND_VALUE
}

/** `--api-key=value`, kept only as a variable the source tool expands. */
const inlineCredentialFlag: ArgumentRule = (value, _next, state) => {
  const separator = value.indexOf('=')
  const flag = value.slice(0, separator)
  if (!value.startsWith('-') || separator <= 0 || !isCredentialName(flag)) return 0
  if (isSourceVariable(value.slice(separator + 1), state.context)) {
    state.args.push(state.literal(value))
  } else warnDropped(`${flag}=…`, state.context)
  return 1
}

/** `--api-key value`, dropped with its flag unless the value is a variable the source expands. */
const credentialFlag: ArgumentRule = (value, next, state) => {
  if (!value.startsWith('-') || !isCredentialName(value) || !next || next.startsWith('-')) return 0
  if (isSourceVariable(next, state.context)) {
    state.args.push(state.literal(value), state.literal(next))
  } else warnDropped(value, state.context)
  return FLAG_AND_VALUE
}

const ARGUMENT_RULES: readonly ArgumentRule[] = [
  containerEnvironment,
  credentialHeader,
  inlineCredentialFlag,
  credentialFlag,
]

/**
 * Arguments as Pi will pass them, without a credential flag's value or the flag itself, plus the
 * vault-backed environment that replaces a credential where the server reads one.
 */
export function portableArguments(
  values: readonly string[],
  command: string | undefined,
  context: ImportValueContext,
  literal: (value: string) => string,
) {
  const state: ArgumentState = {
    args: [],
    env: {},
    container: CONTAINER_COMMANDS.has(commandName(command)),
    remote: values.some((value) => commandName(value) === MCP_REMOTE),
    context,
    literal,
  }
  let index = 0
  while (index < values.length) {
    const value = values[index] ?? ''
    const next = values[index + 1]
    const consumed = ARGUMENT_RULES.reduce((taken, rule) => taken || rule(value, next, state), 0)
    if (consumed === 0) state.args.push(urlWithoutCredentials(literal(value), 'args', context))
    index += Math.max(consumed, 1)
  }
  return { args: state.args, env: state.env }
}
