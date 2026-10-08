import type { ClientOptions } from '@modelcontextprotocol/client'
import {
  MCP_CONFIG,
  MCP_LATEST_PROTOCOL_VERSION,
  MCP_LEGACY_PROTOCOL_VERSIONS,
  MCP_SUPPORTED_PROTOCOL_VERSIONS,
} from '@shared/constants/mcp'

type ProtocolOptions = Pick<ClientOptions, 'supportedProtocolVersions' | 'versionNegotiation'>

/**
 * The fields of a server entry that pick its protocol revisions. Only the hosted
 * `openwaggle mcp serve` tests use this now, to connect a client of each protocol era; Pi's MCP
 * client negotiates its own revisions (ADR 0050).
 */
interface McpProtocolSelection {
  readonly definition: {
    readonly compatibility?: string
    readonly transport?: string
    readonly protocolVersion?: string
  }
}

function isLegacyRevision(version: string) {
  return MCP_LEGACY_PROTOCOL_VERSIONS.some((candidate) => candidate === version)
}

export function getMcpProtocolOptions(server: McpProtocolSelection): ProtocolOptions {
  const profile =
    server.definition.compatibility ??
    (server.definition.transport === 'sse'
      ? 'legacy-sse'
      : server.definition.transport === 'websocket'
        ? 'legacy-websocket'
        : 'auto')
  const pin = server.definition.protocolVersion

  if (profile.startsWith('legacy-') || (pin && isLegacyRevision(pin))) {
    return {
      supportedProtocolVersions: pin ? [pin] : [...MCP_LEGACY_PROTOCOL_VERSIONS],
      versionNegotiation: { mode: 'legacy' },
    }
  }

  if (profile === 'modern-only' || pin === MCP_LATEST_PROTOCOL_VERSION) {
    return {
      supportedProtocolVersions: [pin ?? MCP_LATEST_PROTOCOL_VERSION],
      versionNegotiation: { mode: { pin: pin ?? MCP_LATEST_PROTOCOL_VERSION } },
    }
  }

  return {
    supportedProtocolVersions: [...MCP_SUPPORTED_PROTOCOL_VERSIONS],
    versionNegotiation: {
      mode: 'auto',
      probe: { timeoutMs: MCP_CONFIG.PROBE_TIMEOUT_MS, maxRetries: 0 },
    },
  }
}
