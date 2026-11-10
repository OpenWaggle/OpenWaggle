import type { McpServerEntry } from '@earendil-works/pi-coding-agent'
import { mcpServerIdentity } from '../../mcp/pool/mcp-connection-pool-api'
import { mcpAppToolNames } from './mcp-app-registry'
import { knownMcpServerState } from './mcp-server-status-registry'

/**
 * Where a Run looks up a server's App tools beyond this Host's memory: the server's cached
 * catalog (`cachedMcpAppToolNames`). Undefined when nothing is known.
 */
export type CachedMcpAppTools = (entry: McpServerEntry) => readonly string[] | undefined

/**
 * The MCP App tools a server is known to have: from this Session's listings, else from its cached
 * catalog, which is the project's (`mcpToolCatalogKeyOf`), else from the last listing of the same
 * server anywhere in the Host (a Run of another Session, Check connection). The Host-wide state is
 * kept by server identity, with no project, so it comes last: another project's listing says
 * little about the server here (review R5 P3-4). Undefined when none of them knows the server.
 */
export function knownMcpAppTools(
  sessionId: string,
  entry: McpServerEntry,
  cached?: CachedMcpAppTools,
): readonly string[] | undefined {
  const own = mcpAppToolNames(sessionId, entry.name)
  if (own) return own
  const fromCatalog = cached?.(entry)
  if (fromCatalog) return fromCatalog
  const known = knownMcpServerState(mcpServerIdentity(entry.name, entry.config))
  if (known?.state === 'connected') {
    return known.tools.filter((tool) => tool.hasApp).map((tool) => tool.name)
  }
  return undefined
}
