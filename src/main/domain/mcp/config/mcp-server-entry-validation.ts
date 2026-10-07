/**
 * Validates one `mcpServers` entry the way Pi's `validateMcpServerConfig` does, plus OpenWaggle's
 * legacy transports and vault secret references (see `mcp-server-config.ts`).
 */
import { validateMcpOAuthConfig } from './mcp-oauth-config'
import {
  isJsonRecord,
  isMcpExposure,
  type JsonRecord,
  MCP_EXPOSURES,
  MCP_LOOPBACK_HOSTS,
  MCP_SERVER_NAME,
  type McpConfiguredValue,
  type McpExposure,
  type McpHttpServerConfigOf,
  type McpSecretReference,
  type McpServerConfigBase,
  type McpServerTransport,
  type McpServerValidation,
  type McpServerValidationOptions,
  type McpStdioServerConfigOf,
  resolveMcpExposureAlias,
} from './mcp-server-config'

type Failure = { readonly ok: false; readonly error: string }

function failure(name: string, message: string): Failure {
  return { ok: false, error: `server "${name}": ${message}` }
}

const EXPOSURE_LIST = MCP_EXPOSURES.map((exposure) => `"${exposure}"`).join(', ')

function isSecretReference(value: unknown): value is McpSecretReference {
  return (
    isJsonRecord(value) &&
    typeof value.secret === 'string' &&
    value.secret.length > 0 &&
    Object.keys(value).length === 1
  )
}

type ValueMapResult =
  | { readonly ok: true; readonly values: Record<string, McpConfiguredValue> | undefined }
  | Failure

function validateValueMap(
  name: string,
  field: 'env' | 'headers',
  value: unknown,
  options: McpServerValidationOptions,
): ValueMapResult {
  if (value === undefined) return { ok: true, values: undefined }
  const shapeError = `${field} must map names to strings`
  if (!isJsonRecord(value)) return failure(name, shapeError)
  const values: Record<string, McpConfiguredValue> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') {
      values[key] = entry
      continue
    }
    if (!isSecretReference(entry)) return failure(name, shapeError)
    if (!options.allowSecretReferences) {
      return failure(
        name,
        `${field} "${key}" uses a vault secret reference, which only OpenWaggle's files (~/.openwaggle/mcp.json and .openwaggle/mcp.json) may hold`,
      )
    }
    values[key] = { secret: entry.secret }
  }
  return { ok: true, values }
}

type ExposureResult =
  | { readonly ok: true; readonly toolExposure: Record<string, McpExposure> | undefined }
  | Failure

function validateToolExposure(name: string, value: unknown): ExposureResult {
  if (value === undefined) return { ok: true, toolExposure: undefined }
  if (!isJsonRecord(value)) return failure(name, 'toolExposure must map tool names to exposures')
  const toolExposure: Record<string, McpExposure> = {}
  for (const [tool, entry] of Object.entries(value)) {
    const resolved = resolveMcpExposureAlias(entry)
    if (!isMcpExposure(resolved)) {
      return failure(name, `toolExposure "${tool}" must be one of ${EXPOSURE_LIST}`)
    }
    toolExposure[tool] = resolved
  }
  return { ok: true, toolExposure }
}

type BaseResult = { readonly ok: true; readonly base: McpServerConfigBase } | Failure

function scalarBaseError(name: string, value: JsonRecord): Failure | undefined {
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') {
    return failure(name, 'enabled must be a boolean')
  }
  if (value.description !== undefined && typeof value.description !== 'string') {
    return failure(name, 'description must be a string')
  }
  if (value.timeout !== undefined && (typeof value.timeout !== 'number' || !(value.timeout > 0))) {
    return failure(name, 'timeout must be a positive number of seconds')
  }
  return undefined
}

function validateBase(name: string, value: JsonRecord): BaseResult {
  const exposure = resolveMcpExposureAlias(value.exposure)
  if (exposure !== undefined && !isMcpExposure(exposure)) {
    return failure(name, `exposure must be one of ${EXPOSURE_LIST}`)
  }
  const toolExposure = validateToolExposure(name, value.toolExposure)
  if (!toolExposure.ok) return toolExposure
  const scalarError = scalarBaseError(name, value)
  if (scalarError) return scalarError
  return {
    ok: true,
    base: {
      ...(exposure === undefined ? {} : { exposure }),
      ...(toolExposure.toolExposure ? { toolExposure: toolExposure.toolExposure } : {}),
      ...(typeof value.enabled === 'boolean' ? { enabled: value.enabled } : {}),
      ...(typeof value.description === 'string' ? { description: value.description } : {}),
      ...(typeof value.timeout === 'number' ? { timeout: value.timeout } : {}),
    },
  }
}

type UrlTransport = McpServerTransport | 'invalid' | 'unsupported'

const HTTP_PROTOCOLS = ['http:', 'https:']
const WEBSOCKET_PROTOCOLS = ['ws:', 'wss:']

function protocolTransport(type: unknown, protocol: string): UrlTransport {
  if (HTTP_PROTOCOLS.includes(protocol)) return 'http'
  return type === undefined && WEBSOCKET_PROTOCOLS.includes(protocol) ? 'websocket' : 'invalid'
}

function urlTransport(type: unknown, url: string): UrlTransport {
  if (!URL.canParse(url)) return 'invalid'
  const protocol = new URL(url).protocol
  if (type === 'sse') return HTTP_PROTOCOLS.includes(protocol) ? 'sse' : 'invalid'
  if (type === 'websocket') return WEBSOCKET_PROTOCOLS.includes(protocol) ? 'websocket' : 'invalid'
  if (type !== undefined && type !== 'http' && type !== 'streamable-http') return 'unsupported'
  return protocolTransport(type, protocol)
}

type AuthResult = { readonly ok: true; readonly auth: { provider: string } | undefined } | Failure

function validateProviderAuth(name: string, value: unknown, url: string): AuthResult {
  if (value === undefined) return { ok: true, auth: undefined }
  if (!isJsonRecord(value) || typeof value.provider !== 'string' || !value.provider) {
    return failure(name, 'auth.provider must be a provider name')
  }
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' && !MCP_LOOPBACK_HOSTS.includes(parsed.hostname)) {
    return failure(name, 'auth requires an https URL, or http on localhost, 127.0.0.1, or [::1]')
  }
  return { ok: true, auth: { provider: value.provider } }
}

function validateUrlServer(
  name: string,
  value: JsonRecord,
  url: string,
  base: McpServerConfigBase,
  options: McpServerValidationOptions,
): McpServerValidation | undefined {
  const transport = urlTransport(value.type, url)
  if (transport === 'unsupported') return undefined
  if (transport === 'invalid' || transport === 'stdio') {
    const plainHttp =
      value.type === 'sse' || value.type === 'http' || value.type === 'streamable-http'
    return failure(
      name,
      plainHttp ? 'url must be an http or https URL' : 'url must be an http, https, ws, or wss URL',
    )
  }
  const headers = validateValueMap(name, 'headers', value.headers, options)
  if (!headers.ok) return headers
  const oauth = validateMcpOAuthConfig(name, value.oauth)
  if (!oauth.ok) return oauth
  const auth = validateProviderAuth(name, value.auth, url)
  if (!auth.ok) return auth
  const config: McpHttpServerConfigOf<McpConfiguredValue> = {
    ...base,
    url,
    ...(headers.values ? { headers: headers.values } : {}),
    ...(oauth.oauth ? { oauth: oauth.oauth } : {}),
    ...(auth.auth ? { auth: auth.auth } : {}),
  }
  return { ok: true, server: { config, transport } }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function validateStdioServer(
  name: string,
  value: JsonRecord,
  command: string,
  base: McpServerConfigBase,
  options: McpServerValidationOptions,
): McpServerValidation {
  if (value.args !== undefined && !isStringArray(value.args)) {
    return failure(name, 'args must be an array of strings')
  }
  const env = validateValueMap(name, 'env', value.env, options)
  if (!env.ok) return env
  if (value.cwd !== undefined && typeof value.cwd !== 'string') {
    return failure(name, 'cwd must be a string')
  }
  const config: McpStdioServerConfigOf<McpConfiguredValue> = {
    ...base,
    command,
    ...(isStringArray(value.args) ? { args: [...value.args] } : {}),
    ...(env.values ? { env: env.values } : {}),
    ...(typeof value.cwd === 'string' ? { cwd: value.cwd } : {}),
  }
  return { ok: true, server: { config, transport: 'stdio' } }
}

/**
 * Validate one entry of the `mcpServers` shape. Returns the config with exposure aliases resolved
 * and unknown fields dropped, or the error Pi would report.
 */
export function validateMcpServerEntry(
  name: string,
  raw: unknown,
  options: McpServerValidationOptions,
): McpServerValidation {
  if (!MCP_SERVER_NAME.test(name)) {
    return { ok: false, error: `invalid server name "${name}" (use letters, digits, "_" and "-")` }
  }
  if (!isJsonRecord(raw)) return { ok: false, error: `server "${name}" must be an object` }
  const base = validateBase(name, raw)
  if (!base.ok) return base
  if (typeof raw.url === 'string') {
    const server = validateUrlServer(name, raw, raw.url, base.base, options)
    if (server) return server
  }
  if (typeof raw.command === 'string' && (raw.type === undefined || raw.type === 'stdio')) {
    return validateStdioServer(name, raw, raw.command, base.base, options)
  }
  return {
    ok: false,
    error: `server "${name}" needs either "command" (stdio) or "url" (streamable HTTP)`,
  }
}
