/**
 * String values of imported entries: environment and header maps, arguments,
 * and the placeholder syntaxes of other tools, rewritten to Pi's `${NAME}`.
 * Plaintext credentials never reach OpenWaggle's file: they become vault
 * references the user fills in.
 */
import { isRecord } from '@shared/utils/validation'
import { piLiteral } from '../../../domain/mcp/config/mcp-pi-literal'
import type { ExternalMcpImportSource } from './import-types'

const SENSITIVE_NAME_PATTERN =
  /(api[-_]?key|token|secret|password|credential|authorization|cookie|private[-_]?key)/i
const REFERENCE_PATTERN = /\$\{[^}]+\}/

export interface ImportValueContext {
  readonly source: ExternalMcpImportSource
  readonly serverName: string
  readonly warnings: string[]
}

export type ImportedCredential = string | { readonly secret: string }

function environmentName(id: string) {
  return id.replace(/[^A-Za-z0-9_]+/g, '_').toUpperCase()
}

function secretName(serverName: string, fieldName: string) {
  return `${serverName}_${fieldName}`.replace(/[^A-Za-z0-9_]+/g, '_').toUpperCase()
}

/**
 * A value Pi takes as written (arguments, OAuth fields other than the client secret). A variable
 * the source tool would have expanded there stays as it is, with a warning: rewriting it to
 * `${NAME}` would not make Pi expand it either.
 */
export function literalString(value: string, location: string, context: ImportValueContext) {
  if (warnVsCodeVariable(value, location, context)) return value
  const pattern = SOURCE_VARIABLES[context.source]
  const variable = pattern ? new RegExp(pattern.source).exec(value)?.[0] : undefined
  if (variable) {
    context.warnings.push(
      `${location} uses ${variable}, which Pi does not expand there; it was kept as written.`,
    )
  }
  return value
}

/** VS Code's predefined variables (`${workspaceFolder}`, `${userHome}`, …): not `env:` or `input:`. */
const VS_CODE_PREDEFINED_VARIABLE = /\$\{(?!env:|input:)[^}]+\}/

/** Warns about a VS Code predefined variable, which nothing but VS Code fills in. */
function warnVsCodeVariable(value: string, location: string, context: ImportValueContext) {
  if (context.source !== 'vscode') return false
  const variable = VS_CODE_PREDEFINED_VARIABLE.exec(value)?.[0]
  if (!variable) return false
  context.warnings.push(
    `${location} uses VS Code's ${variable}, which only VS Code fills in; Pi takes it as written, so put the real value there.`,
  )
  return true
}

/** True for values Pi resolves when it connects (`${VAR}` or `!command`), not literal secrets. */
function isResolvedLater(value: string) {
  return REFERENCE_PATTERN.test(value) || value.startsWith('!')
}

const NAME = '[A-Za-z_][A-Za-z0-9_]*'
const ENV_REFERENCE = `\\$\\{env:(${NAME})\\}`

/**
 * The variable syntaxes each tool really expands in `env` and `headers` values, with the Pi
 * variable each one becomes. Everything else is literal text there: Claude Desktop, Codex, and Zed
 * pass values as written.
 */
const SOURCE_VARIABLES: Readonly<Record<ExternalMcpImportSource, RegExp | undefined>> = {
  'claude-code': new RegExp(`\\$\\{(${NAME})(:-[^}]*)?\\}`, 'g'),
  cursor: new RegExp(ENV_REFERENCE, 'g'),
  vscode: new RegExp(`\\$\\{(?:env:(${NAME})|input:([^}]+))\\}`, 'g'),
  windsurf: new RegExp(ENV_REFERENCE, 'g'),
  opencode: new RegExp(`\\{env:(${NAME})\\}`, 'g'),
  'claude-desktop': undefined,
  codex: undefined,
  zed: undefined,
}

function variableName(match: RegExpMatchArray, location: string, context: ImportValueContext) {
  const [, name, second] = match
  if (context.source === 'vscode' && second !== undefined) {
    const variable = environmentName(second)
    context.warnings.push(
      `${location} asked for VS Code input ${second}; Pi reads environment variable ${variable} there instead, so set it in your shell.`,
    )
    return variable
  }
  if (context.source === 'claude-code' && second !== undefined) {
    context.warnings.push(`${location} had a default for ${name ?? ''}, which Pi does not support.`)
  }
  return name ?? ''
}

/**
 * An `env`, `headers`, or OAuth secret value as Pi will read it: the variables the source tool
 * expands become Pi's `${NAME}`, and everything else stays literal (`$` → `$$`, a leading `!` →
 * `$!`), so a value from another tool is never run as a command or read as a variable it was not.
 */
export function piValueFrom(value: string, location: string, context: ImportValueContext) {
  warnVsCodeVariable(value, location, context)
  const pattern = SOURCE_VARIABLES[context.source]
  if (!pattern) return { value: piLiteral(value), references: false }
  let result = ''
  let last = 0
  let references = false
  for (const match of value.matchAll(pattern)) {
    result += escapeDollars(value.slice(last, match.index))
    result += `\${${variableName(match, location, context)}}`
    last = match.index + match[0].length
    references = true
  }
  result += escapeDollars(value.slice(last))
  return { value: result.startsWith('!') ? `$${result}` : result, references }
}

function escapeDollars(text: string) {
  return text.replaceAll('$', () => '$$')
}

function credentialValue(
  fieldName: string,
  value: unknown,
  location: string,
  context: ImportValueContext,
): ImportedCredential | undefined {
  if (typeof value !== 'string') {
    context.warnings.push(`${location} was ignored because its value is not a string.`)
    return undefined
  }
  const pi = piValueFrom(value, location, context)
  if (pi.references || !SENSITIVE_NAME_PATTERN.test(fieldName)) return pi.value
  const name = secretName(context.serverName, fieldName)
  context.warnings.push(
    `${location} contains a plaintext credential. Its value was not imported; save it as vault secret ${name}.`,
  )
  return { secret: name }
}

/** An `env` or `headers` map. */
export function credentialMap(value: unknown, mapName: string, context: ImportValueContext) {
  if (!isRecord(value)) return undefined
  const result: Record<string, ImportedCredential> = {}
  for (const [fieldName, entry] of Object.entries(value)) {
    const credential = credentialValue(fieldName, entry, `${mapName}.${fieldName}`, context)
    if (credential !== undefined) result[fieldName] = credential
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function isCredentialFlag(value: string) {
  return value.startsWith('-') && SENSITIVE_NAME_PATTERN.test(value)
}

/**
 * Arguments, without the value of a credential flag: the argument after `--api-key`, or all of
 * `--api-key=VALUE` (Pi passes arguments as written, so no vault reference can stand there). The
 * value is never repeated in a warning.
 */
export function portableArgs(values: readonly string[], context: ImportValueContext) {
  const result: string[] = []
  let credentialFlag: string | undefined
  for (const value of values) {
    if (credentialFlag !== undefined && !isResolvedLater(value)) {
      context.warnings.push(
        `A command-line credential after ${credentialFlag} was not imported. Move it to the encrypted vault or an environment variable.`,
      )
      credentialFlag = undefined
      continue
    }
    credentialFlag = undefined
    const separator = value.indexOf('=')
    const flag = separator > 0 ? value.slice(0, separator) : value
    if (separator > 0 && isCredentialFlag(flag)) {
      if (!isResolvedLater(value.slice(separator + 1))) {
        context.warnings.push(
          `A command-line credential in ${flag}=… was not imported. Move it to the encrypted vault or an environment variable.`,
        )
        continue
      }
      result.push(literalString(value, 'args', context))
      continue
    }
    const portable = literalString(value, 'args', context)
    result.push(portable)
    if (isCredentialFlag(portable)) credentialFlag = portable
  }
  return result
}

export function stringArray(value: unknown) {
  if (!Array.isArray(value)) return undefined
  const strings = value.filter((entry): entry is string => typeof entry === 'string')
  return strings.length === value.length ? strings : undefined
}

export function nonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined
}
