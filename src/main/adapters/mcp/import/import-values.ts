/**
 * String values of imported entries: environment and header maps, arguments,
 * and the placeholder syntaxes of other tools, rewritten to Pi's `${NAME}`.
 * Plaintext credentials never reach OpenWaggle's file: they become vault
 * references the user fills in.
 */
import { isRecord } from '@shared/utils/validation'

const SENSITIVE_NAME_PATTERN =
  /(api[-_]?key|token|secret|password|credential|authorization|cookie|private[-_]?key)/i
const VSCODE_INPUT_PATTERN = /\$\{input:([^}]+)\}/g
const OPENCODE_ENV_PATTERN = /\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g
const REFERENCE_PATTERN = /\$\{[^}]+\}/

export interface ImportValueContext {
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

/** Rewrite VS Code `${input:id}` and OpenCode `{env:NAME}` placeholders to `${NAME}`. */
export function portableString(value: string, location: string, context: ImportValueContext) {
  const withInputs = value.replace(VSCODE_INPUT_PATTERN, (_match, id: string) => {
    const name = environmentName(id)
    context.warnings.push(
      `${location} asked for VS Code input ${id}; set environment variable ${name} instead.`,
    )
    return `\${${name}}`
  })
  return withInputs.replace(OPENCODE_ENV_PATTERN, (_match, name: string) => `\${${name}}`)
}

/** True for values Pi resolves when it connects (`${VAR}` or `!command`), not literal secrets. */
function isResolvedLater(value: string) {
  return REFERENCE_PATTERN.test(value) || value.startsWith('!')
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
  const portable = portableString(value, location, context)
  if (isResolvedLater(portable) || !SENSITIVE_NAME_PATTERN.test(fieldName)) return portable
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

/** Arguments, without the value that follows a credential flag such as `--api-key`. */
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
    const portable = portableString(value, 'args', context)
    result.push(portable)
    if (portable.startsWith('-') && SENSITIVE_NAME_PATTERN.test(portable)) credentialFlag = portable
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
