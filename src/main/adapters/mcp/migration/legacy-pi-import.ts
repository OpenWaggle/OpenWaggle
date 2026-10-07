/**
 * Exact reproduction of the pre-ADR-0048 importer's normalization and hashing
 * (the removed `import-normalization.ts`, `config-identity.ts`, and `import-adapters.ts` on the
 * old code), so the migration can tell whether a Pi entry still matches the
 * copy the old importer made. Do not "improve" these rules: the fingerprints
 * already written to users' files depend on every detail.
 */
import { createHash } from 'node:crypto'
import { isRecord } from '@shared/utils/validation'

type LegacyValue = string | number | boolean | null | LegacyValue[] | { [key: string]: LegacyValue }

const SENSITIVE_NAME_PATTERN =
  /(api[-_]?key|token|secret|password|credential|authorization|cookie|private[-_]?key)/i
const ENV_REFERENCE_PATTERN = /^\$\{([A-Z_][A-Z0-9_]*)(?::-.*)?\}$/
const INPUT_REFERENCE_PATTERN = /^\$\{input:([^}]+)\}$/i
const LEGACY_COMPATIBILITY_PROFILES = new Set([
  'auto',
  'modern-only',
  'legacy-stateful-http',
  'legacy-sse',
  'legacy-websocket',
])

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isRecord(value)) return value
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    const next = value[key]
    if (next !== undefined) result[key] = canonicalize(next)
  }
  return result
}

/** `hashMcpServerDefinition`: SHA-256 of the key-sorted JSON. */
export function legacyDefinitionHash(definition: unknown) {
  return sha256(JSON.stringify(canonicalize(definition)))
}

/** `createMcpRevision` over `[source, sourcePath, name, definitionHash]`. */
export function legacyImportFingerprint(input: {
  readonly source: string
  readonly sourcePath: string
  readonly name: string
  readonly definition: unknown
}) {
  return sha256(
    [input.source, input.sourcePath, input.name, legacyDefinitionHash(input.definition)].join(
      '\u0000',
    ),
  )
}

/** `createMcpServerIdentityKey`: the state.json key of a server defined in `sourcePath`. */
export function legacyServerIdentityKey(sourcePath: string, serverName: string) {
  return sha256(`${sourcePath}\u0000${serverName}`)
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return undefined
  const strings = value.filter((entry): entry is string => typeof entry === 'string')
  return strings.length === value.length ? strings : undefined
}

function secretName(serverName: string, fieldName: string) {
  return `${serverName}_${fieldName}`.replace(/[^A-Za-z0-9_]+/g, '_').toUpperCase()
}

function credentialValue(serverName: string, fieldName: string, value: unknown) {
  if (typeof value !== 'string') return undefined
  const envReference = ENV_REFERENCE_PATTERN.exec(value)
  if (envReference?.[1]) return { secret: envReference[1] }
  const inputReference = INPUT_REFERENCE_PATTERN.exec(value)
  if (inputReference?.[1]) return { secret: secretName(serverName, inputReference[1]) }
  if (!SENSITIVE_NAME_PATTERN.test(fieldName)) return value
  return { secret: secretName(serverName, fieldName) }
}

function credentialMap(serverName: string, value: unknown) {
  if (!isRecord(value)) return undefined
  const result: Record<string, LegacyValue> = {}
  for (const [fieldName, entry] of Object.entries(value)) {
    const credential = credentialValue(serverName, fieldName, entry)
    if (credential !== undefined) result[fieldName] = credential
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function sanitizeArgs(values: readonly string[] | undefined) {
  if (!values) return undefined
  const result: string[] = []
  let skipValue = false
  for (const value of values) {
    if (skipValue) {
      skipValue = false
      continue
    }
    result.push(value)
    skipValue = value.startsWith('-') && SENSITIVE_NAME_PATTERN.test(value)
  }
  return result
}

function transportValue(value: unknown, hasUrl: boolean) {
  if (value === 'stdio' || value === 'sse' || value === 'websocket') return value
  if (value === 'http' || value === 'remote' || value === 'streamable-http') {
    return 'streamable-http'
  }
  return hasUrl ? 'streamable-http' : undefined
}

function directToolsValue(value: unknown) {
  if (typeof value === 'boolean') return value
  return stringArray(value)
}

function endpointFields(value: Record<string, unknown>) {
  const commandArray = stringArray(value.command)
  const command = commandArray?.[0] ?? stringValue(value.command)
  const args = sanitizeArgs(commandArray?.slice(1) ?? stringArray(value.args))
  const url = stringValue(value.url)
  return {
    ...(command ? { command } : {}),
    ...(args?.length ? { args } : {}),
    ...(url ? { url } : {}),
  }
}

function credentialFields(value: Record<string, unknown>, name: string) {
  const env = credentialMap(name, value.env ?? value.environment)
  const headers = credentialMap(name, value.headers ?? value.http_headers)
  const bearerTokenEnv = stringValue(value.bearer_token_env_var)
  return {
    ...(env ? { env } : {}),
    ...(bearerTokenEnv
      ? { headers: { ...headers, Authorization: { secret: bearerTokenEnv } } }
      : headers
        ? { headers }
        : {}),
  }
}

function optionFields(value: Record<string, unknown>) {
  const url = stringValue(value.url)
  const transport = transportValue(value.transport ?? value.type, Boolean(url))
  const compatibility =
    typeof value.compatibility === 'string' &&
    LEGACY_COMPATIBILITY_PROFILES.has(value.compatibility)
      ? value.compatibility
      : undefined
  const directTools = directToolsValue(value.directTools)
  const cwd = stringValue(value.cwd)
  const protocolVersion = stringValue(value.protocolVersion)
  return {
    ...(cwd ? { cwd } : {}),
    ...(transport ? { transport } : {}),
    ...(compatibility ? { compatibility } : {}),
    ...(protocolVersion ? { protocolVersion } : {}),
    ...(directTools === undefined ? {} : { directTools }),
  }
}

/** `normalizeImportedMcpServer(source, name, value).definition`. */
export function legacyNormalizeImportedServer(name: string, value: unknown) {
  if (!isRecord(value)) return undefined
  return {
    ...endpointFields(value),
    ...credentialFields(value, name),
    ...optionFields(value),
  }
}
