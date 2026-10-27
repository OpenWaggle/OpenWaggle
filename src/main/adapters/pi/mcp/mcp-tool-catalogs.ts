import path from 'node:path'
import type { McpServerEntry } from '@earendil-works/pi-coding-agent'
import type { McpTransportKind } from '../../../domain/mcp/config/mcp-server-config'
import { mcpBuildStateDirectory } from '../../mcp/credentials/mcp-build-state-paths'
import {
  fileBackedMcpToolCatalogStore,
  McpConnectionCatalog,
  type McpToolCatalogStore,
  mcpToolCatalogKey,
} from '../../mcp/pool/mcp-connection-catalog'
import { mcpConnectionFingerprint, mcpServerIdentity } from '../../mcp/pool/mcp-server-identity'
import { mcpConnectionConfig } from './pi-mcp-server-oauth'

/** The Host's MCP tool catalogs, next to its other MCP state (D1.3). */
export const hostMcpToolCatalogStore: McpToolCatalogStore = fileBackedMcpToolCatalogStore(() =>
  path.join(mcpBuildStateDirectory(), 'tool-catalogs'),
)

/** Where a server's catalog is kept: the same key from the configuration and from a lease. */
export function mcpToolCatalogKeyOf(input: {
  readonly entry: McpServerEntry
  readonly config: {
    readonly transports: ReadonlyMap<string, McpTransportKind>
    readonly connectionConfigs?: ReadonlyMap<string, McpServerEntry['config']>
  }
  readonly projectPath: string | null
}) {
  const { entry, config } = input
  return mcpToolCatalogKey({
    identity: mcpServerIdentity(entry.name, entry.config),
    connectionFingerprint: mcpConnectionFingerprint({
      config: mcpConnectionConfig(config.connectionConfigs, entry),
      transport: config.transports.get(entry.name) ?? ('url' in entry.config ? 'http' : 'stdio'),
      // Every worktree and folder of the project shares the catalog.
      cwd: '',
    }),
    projectPath: input.projectPath,
  })
}

/** The first line of the server instructions its last handshake gave. */
function cachedInstructionsLine(store: McpToolCatalogStore, key: string) {
  const initialize = new McpConnectionCatalog(store, key).servedInitialize
  if (typeof initialize !== 'object' || initialize === null || !('instructions' in initialize)) {
    return undefined
  }
  const { instructions } = initialize
  if (typeof instructions !== 'string') return undefined
  return instructions.trim().split('\n', 1)[0]?.trim() || undefined
}

/**
 * Servers without a configured description get the first line of their cached instructions as
 * one, so Pi's `<mcp_servers>` section reads the same before and after they connect (C9).
 */
export function withCachedMcpDescriptions<
  T extends { readonly servers: readonly McpServerEntry[] },
>(
  loaded: T,
  keyOf: (entry: McpServerEntry) => string,
  store: McpToolCatalogStore = hostMcpToolCatalogStore,
): T {
  const servers = loaded.servers.map((entry) => {
    if (entry.config.description?.trim()) return entry
    const description = cachedInstructionsLine(store, keyOf(entry))
    return description ? { ...entry, config: { ...entry.config, description } } : entry
  })
  return { ...loaded, servers }
}
