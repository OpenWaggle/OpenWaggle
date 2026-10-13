/**
 * Which MCP servers Usage statistics may name: entries of OpenWaggle's curated catalog only, as
 * listed in src/shared/usage-statistics/catalog.generated.ts, which the endpoint enforces too.
 */
import { MCP_CATALOG_SERVERS } from '@shared/constants/mcp'
import { USAGE_STATISTICS_CATALOG_MCP_SERVERS } from '@shared/usage-statistics/catalog.generated'
import { USAGE_STATISTICS_CUSTOM_IDENTIFIER } from '@shared/usage-statistics/contract'
import { mcpNamespace } from '../mcp/config/mcp-server-config'

/** How a server is launched: its command and arguments, or its URL. */
export interface UsageStatisticsMcpServerLaunch {
  readonly command?: string
  readonly args?: readonly string[]
  readonly url?: string
}

/** The launch fields of a catalog entry, whatever else it holds. */
function catalogLaunch(entry: Readonly<Record<string, unknown>>): UsageStatisticsMcpServerLaunch {
  const args = Array.isArray(entry.args)
    ? entry.args.filter((arg): arg is string => typeof arg === 'string')
    : undefined
  return {
    ...(typeof entry.command === 'string' ? { command: entry.command } : {}),
    ...(args ? { args } : {}),
    ...(typeof entry.url === 'string' ? { url: entry.url } : {}),
  }
}

function sameLaunch(left: UsageStatisticsMcpServerLaunch, right: UsageStatisticsMcpServerLaunch) {
  return (
    left.command === right.command &&
    left.url === right.url &&
    JSON.stringify(left.args ?? []) === JSON.stringify(right.args ?? [])
  )
}

/**
 * The catalog name of the server a tool call reached, or `custom`. A server counts as a catalog
 * server only when its name matches a catalog entry as Pi names tools (`-` and `_` are the same)
 * and its configuration launches exactly as that entry does, so a user's own server that happens
 * to share a catalog name stays `custom`.
 */
export function usageStatisticsMcpServerIdentifier(server: {
  readonly name: string
  readonly launch: UsageStatisticsMcpServerLaunch | undefined
}) {
  const entry = MCP_CATALOG_SERVERS.find(
    (candidate) => mcpNamespace(candidate.name) === mcpNamespace(server.name),
  )
  if (!entry || !server.launch || !USAGE_STATISTICS_CATALOG_MCP_SERVERS.includes(entry.name)) {
    return USAGE_STATISTICS_CUSTOM_IDENTIFIER
  }
  return sameLaunch(server.launch, catalogLaunch(entry.entry))
    ? entry.name
    : USAGE_STATISTICS_CUSTOM_IDENTIFIER
}
