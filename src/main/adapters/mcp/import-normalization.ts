import type {
  McpCompatibilityProfile,
  McpConfigCredentialValue,
  McpDirectToolsConfig,
  McpImportSource,
  McpServerDefinition,
  McpServerTransport,
} from '@shared/types/mcp'

const KNOWN_SOURCE_FIELDS = new Set([
  'type',
  'transport',
  'command',
  'args',
  'cwd',
  'env',
  'environment',
  'url',
  'headers',
  'http_headers',
  'env_http_headers',
  'bearer_token_env_var',
  'enabled',
  'disabled',
  'directTools',
  'protocolVersion',
  'compatibility',
  'timeout',
  'startup_timeout_sec',
  'tool_timeout_sec',
  'oauth',
])

const SENSITIVE_NAME_PATTERN =
  /(api[-_]?key|token|secret|password|credential|authorization|cookie|private[-_]?key)/i
const ENV_REFERENCE_PATTERN = /^\$\{([A-Z_][A-Z0-9_]*)(?::-.*)?\}$/
const INPUT_REFERENCE_PATTERN = /^\$\{input:([^}]+)\}$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function stringArray(value: unknown) {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) return undefined
  return value
}

function secretName(serverName: string, fieldName: string) {
  return `${serverName}_${fieldName}`.replace(/[^A-Za-z0-9_]+/g, '_').toUpperCase()
}

function credentialValue(input: {
  readonly serverName: string
  readonly fieldName: string
  readonly value: unknown
  readonly warnings: string[]
}): McpConfigCredentialValue | undefined {
  if (typeof input.value !== 'string') {
    input.warnings.push(`${input.fieldName} was ignored because its value is not a string.`)
    return undefined
  }
  const envReference = ENV_REFERENCE_PATTERN.exec(input.value)
  if (envReference?.[1]) return { secret: envReference[1] }
  const inputReference = INPUT_REFERENCE_PATTERN.exec(input.value)
  if (inputReference?.[1]) return { secret: secretName(input.serverName, inputReference[1]) }
  if (!SENSITIVE_NAME_PATTERN.test(input.fieldName)) return input.value
  const name = secretName(input.serverName, input.fieldName)
  input.warnings.push(
    `${input.fieldName} contains a plaintext credential. Its value was not imported; save it as vault secret ${name}.`,
  )
  return { secret: name }
}

function credentialMap(input: {
  readonly serverName: string
  readonly value: unknown
  readonly warnings: string[]
}) {
  if (!isRecord(input.value)) return undefined
  const result: Record<string, McpConfigCredentialValue> = {}
  for (const [fieldName, value] of Object.entries(input.value)) {
    const credential = credentialValue({ ...input, fieldName, value })
    if (credential !== undefined) result[fieldName] = credential
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function sanitizeArgs(
  serverName: string,
  values: readonly string[] | undefined,
  warnings: string[],
) {
  if (!values) return undefined
  const result: string[] = []
  let skipValue = false
  for (const value of values) {
    if (skipValue) {
      warnings.push(
        `A command-line credential for ${result.at(-1) ?? serverName} was not imported. Move it to the encrypted vault and update the server definition.`,
      )
      skipValue = false
      continue
    }
    result.push(value)
    skipValue = value.startsWith('-') && SENSITIVE_NAME_PATTERN.test(value)
  }
  return result
}

function transportValue(value: unknown, hasUrl: boolean): McpServerTransport | undefined {
  if (value === 'stdio' || value === 'sse' || value === 'websocket') return value
  if (value === 'http' || value === 'remote' || value === 'streamable-http') {
    return 'streamable-http'
  }
  return hasUrl ? 'streamable-http' : undefined
}

function compatibilityValue(value: unknown): McpCompatibilityProfile | undefined {
  if (
    value === 'auto' ||
    value === 'modern-only' ||
    value === 'legacy-stateful-http' ||
    value === 'legacy-sse' ||
    value === 'legacy-websocket'
  ) {
    return value
  }
  return undefined
}

function directToolsValue(value: unknown): McpDirectToolsConfig | undefined {
  if (typeof value === 'boolean') return value
  return stringArray(value)
}

function endpointFields(value: Record<string, unknown>, name: string, warnings: string[]) {
  const commandArray = stringArray(value.command)
  const command = commandArray?.[0] ?? stringValue(value.command)
  const args = sanitizeArgs(name, commandArray?.slice(1) ?? stringArray(value.args), warnings)
  const url = stringValue(value.url)
  return {
    ...(command ? { command } : {}),
    ...(args?.length ? { args } : {}),
    ...(url ? { url } : {}),
  }
}

function credentialFields(value: Record<string, unknown>, name: string, warnings: string[]) {
  const env = credentialMap({ serverName: name, value: value.env ?? value.environment, warnings })
  const headers = credentialMap({
    serverName: name,
    value: value.headers ?? value.http_headers,
    warnings,
  })
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
  const compatibility = compatibilityValue(value.compatibility)
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

function collectWarnings(
  source: McpImportSource,
  value: Record<string, unknown>,
  warnings: string[],
) {
  if (value.disabled === true || value.enabled === false) {
    warnings.push('The source server is disabled. OpenWaggle imports it disabled.')
  }
  if (value.oauth !== undefined) {
    warnings.push(
      'OAuth tokens and trust state are not imported; authenticate again in OpenWaggle.',
    )
  }
  for (const field of Object.keys(value).filter((field) => !KNOWN_SOURCE_FIELDS.has(field))) {
    warnings.push(`${source} field ${field} is not portable and was not imported.`)
  }
}

export function normalizeImportedMcpServer(source: McpImportSource, name: string, value: unknown) {
  if (!isRecord(value)) return null
  const warnings: string[] = []
  const definition: McpServerDefinition = {
    ...endpointFields(value, name, warnings),
    ...credentialFields(value, name, warnings),
    ...optionFields(value),
  }
  collectWarnings(source, value, warnings)
  if (!definition.command && !definition.url) {
    warnings.push('No portable command or URL was found; this candidate cannot be imported.')
  }
  return { definition, warnings }
}
