/**
 * MCP server entries in Pi's `mcpServers` format, validated the way Pi validates them.
 *
 * Mirrors `validateMcpServerConfig` in Pi's `core/mcp-servers.ts` so that every file Pi reads means
 * the same thing in OpenWaggle. OpenWaggle accepts three things Pi does not: legacy SSE endpoints
 * (`"type": "sse"`), WebSocket endpoints (`ws:`/`wss:` URLs or `"type": "websocket"`), and vault
 * secret references (`{ "secret": "<name>" }`) as `env` or `headers` values in OpenWaggle's own
 * files. Pi receives SSE and WebSocket entries as ordinary URL entries; the transport kind travels
 * beside the config.
 */

export const MCP_EXPOSURES = ['codemode', 'deferred', 'direct', 'hidden'] as const

export type McpExposure = (typeof MCP_EXPOSURES)[number]

/** Older exposure names, accepted and replaced by their current name, as in Pi. */
const MCP_EXPOSURE_ALIASES: Readonly<Record<string, McpExposure>> = {
  'codemode-deferred': 'codemode',
}

export type McpTransportKind = 'stdio' | 'http' | 'sse' | 'websocket'

/** A value OpenWaggle resolves from its encrypted vault before Pi sees the config. */
export interface McpVaultSecretReference {
  readonly secret: string
}

/** An `env` or `headers` value as configured: plain text, or a vault reference in OpenWaggle's files. */
export type McpConfiguredValue = string | McpVaultSecretReference

export interface McpServerConfigBase {
  exposure?: McpExposure
  description?: string
  toolExposure?: Record<string, McpExposure>
  enabled?: boolean
  timeout?: number
}

export interface McpStdioServerConfigOf<Value> extends McpServerConfigBase {
  command: string
  args?: string[]
  env?: Record<string, Value>
  cwd?: string
}

export interface McpOAuthConfig {
  clientId?: string
  clientSecret?: string
  callbackPort?: number
  callbackUrl?: string
  scope?: string
  clientName?: string
  clientRegistration?: 'dcr' | 'cimd'
  authServerMetadataUrl?: string
}

export interface McpHttpServerConfigOf<Value> extends McpServerConfigBase {
  url: string
  headers?: Record<string, Value>
  oauth?: McpOAuthConfig
  auth?: { provider: string }
}

export type McpServerConfigOf<Value> = McpStdioServerConfigOf<Value> | McpHttpServerConfigOf<Value>

/** A config as written in a file, before vault references are resolved. */
export type McpConfiguredServerConfig = McpServerConfigOf<McpConfiguredValue>

/** A config with every value resolved: the shape Pi's MCP extension receives. */
export type McpServerConfig = McpServerConfigOf<string>

export interface McpValidatedServer {
  readonly config: McpConfiguredServerConfig
  readonly transport: McpTransportKind
}

export type McpServerValidation =
  | { readonly ok: true; readonly server: McpValidatedServer }
  | { readonly ok: false; readonly error: string }

export interface McpServerValidationOptions {
  /** OpenWaggle's own files may hold vault secret references; files other clients read may not. */
  readonly allowSecretReferences: boolean
}

export const MCP_SERVER_NAME = /^[A-Za-z0-9_-]+$/
export const MCP_LOOPBACK_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '[::1]']

/** Keys an override-only entry may set, as in Pi. */
export const MCP_OVERRIDE_KEYS = ['enabled', 'exposure', 'toolExposure'] as const

export type JsonRecord = Record<string, unknown>

export function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether an entry overrides a server defined in an earlier file instead of defining one. */
export function isMcpOverrideEntry(value: JsonRecord) {
  return value.command === undefined && value.url === undefined && value.type === undefined
}

/** Namespace of a server's tools: `mcp__<server>` with `-` replaced by `_`, as in Pi. */
export function mcpNamespace(server: string) {
  return `mcp__${server.replace(/-/g, '_')}`
}

function toolPatternRegExp(pattern: string) {
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${source}$`)
}

/** Exposure of one tool: its exact `toolExposure` entry, else the first matching pattern, else the server's. */
export function getMcpToolExposure(
  config: Pick<McpServerConfigBase, 'exposure' | 'toolExposure'>,
  toolName: string,
): McpExposure {
  const overrides = config.toolExposure ?? {}
  const exact = overrides[toolName]
  if (exact !== undefined) return exact
  for (const [pattern, exposure] of Object.entries(overrides)) {
    if (pattern.includes('*') && toolPatternRegExp(pattern).test(toolName)) return exposure
  }
  return config.exposure ?? 'codemode'
}

export function isMcpExposure(value: unknown): value is McpExposure {
  return MCP_EXPOSURES.some((exposure) => exposure === value)
}

export function resolveMcpExposureAlias(value: unknown) {
  return typeof value === 'string' ? (MCP_EXPOSURE_ALIASES[value] ?? value) : value
}
