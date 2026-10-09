/**
 * String values of imported entries: environment and header maps, arguments,
 * and the placeholder syntaxes of other tools, rewritten to Pi's `${NAME}`.
 * Plaintext credentials never reach OpenWaggle's file: they become vault
 * references the user fills in.
 */
import { isRecord } from '@shared/utils/validation'
import { piLiteral } from '../../../domain/mcp/config/mcp-pi-literal'
import { isCredentialName, portableArguments } from './import-credentials'
import type { ExternalMcpImportSource } from './import-types'
import { sourceVariablePattern } from './import-variables'

export interface ImportValueContext {
  readonly source: ExternalMcpImportSource
  readonly serverName: string
  readonly warnings: string[]
  /** Vault-backed variables that replace credentials found in the arguments. */
  readonly argumentEnv: Record<string, ImportedCredential>
  /** Variables an argument reads a credential from, such as an mcp-remote header's `${VAR}`. */
  readonly credentialEnvNames: Set<string>
}

export type ImportedCredential = string | { readonly secret: string }

function environmentName(id: string) {
  return id.replace(/[^A-Za-z0-9_]+/g, '_').toUpperCase()
}

/**
 * A value Pi takes as written (arguments, OAuth fields other than the client secret). A variable
 * the source tool would have expanded there stays as it is, with a warning: rewriting it to
 * `${NAME}` would not make Pi expand it either.
 */
export function literalString(value: string, location: string, context: ImportValueContext) {
  if (warnVsCodeVariable(value, location, context)) return value
  const pattern = sourceVariablePattern(context.source)
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
  const pattern = sourceVariablePattern(context.source)
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
  const credential = isCredentialName(fieldName) || context.credentialEnvNames.has(fieldName)
  if (pi.references || !credential) return pi.value
  // Named after the field until the import places the server: the vault secret is then named
  // `<SERVER>_<FIELD>` after the name it is saved as, which a rename can change.
  context.warnings.push(
    `${location} contains a plaintext credential. Its value was not imported; it becomes a vault secret named after the server and ${fieldName}, which you fill in after importing.`,
  )
  return { secret: fieldName }
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

/**
 * Arguments, without any credential they carry; see `portableArguments`. A credential the server
 * can read from its environment is added to `context.argumentEnv` as a vault reference.
 */
export function portableArgs(
  values: readonly string[],
  command: string | undefined,
  context: ImportValueContext,
) {
  const portable = portableArguments(
    values,
    command,
    context,
    (value) => literalString(value, 'args', context),
    (name, value) => credentialValue(name, value, `args ${name}`, context),
  )
  Object.assign(context.argumentEnv, portable.env)
  return portable.args
}

export function stringArray(value: unknown) {
  if (!Array.isArray(value)) return undefined
  const strings = value.filter((entry): entry is string => typeof entry === 'string')
  return strings.length === value.length ? strings : undefined
}

export function nonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined
}
