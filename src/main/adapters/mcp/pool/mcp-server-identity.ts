import { createHash } from 'node:crypto'
import type {
  McpServerConfig,
  McpServerTransport,
} from '../../../domain/mcp/config/mcp-server-config'

const IDENTITY_HASH_LENGTH = 16

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

/** JSON with object keys sorted, so equal configs hash equally whatever their key order. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * The identity remembered approval grants are bound to: the server name with what it runs or
 * where it connects. A different server reusing a name therefore does not inherit grants, and
 * changing credentials or exposure does not drop them.
 */
export function mcpServerIdentity(name: string, config: McpServerConfig) {
  const target = 'url' in config ? config.url : [config.command, ...(config.args ?? [])].join('\0')
  return `mcp-server:${sha256(`${name}\0${target}`).slice(0, IDENTITY_HASH_LENGTH)}`
}

/**
 * What a connection is made of. A Session reuses its connection while this stays the same, so
 * changing exposure, description, or enabled state does not reconnect, but changing the command,
 * URL, environment, headers, OAuth settings, or working directory does.
 */
export function mcpConnectionFingerprint(input: {
  readonly config: McpServerConfig
  readonly transport: McpServerTransport
  readonly cwd: string
}) {
  const {
    enabled: _enabled,
    exposure: _exposure,
    toolExposure: _tools,
    description: _description,
    ...connection
  } = input.config
  return sha256(stableJson({ transport: input.transport, cwd: input.cwd, connection }))
}
