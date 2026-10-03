/**
 * Which MCP servers Usage statistics may name: entries of OpenWaggle's curated catalog only, as
 * listed in src/shared/usage-statistics/catalog.generated.ts, which the endpoint enforces too.
 */
import { MCP_CATALOG_SERVERS } from '@shared/constants/mcp'
import type { McpServerDefinition } from '@shared/types/mcp'
import { USAGE_STATISTICS_CATALOG_MCP_SERVERS } from '@shared/usage-statistics/catalog.generated'
import { USAGE_STATISTICS_CUSTOM_IDENTIFIER } from '@shared/usage-statistics/contract'

function sameLaunch(left: McpServerDefinition, right: McpServerDefinition) {
  return (
    left.command === right.command &&
    left.url === right.url &&
    JSON.stringify(left.args ?? []) === JSON.stringify(right.args ?? [])
  )
}

/**
 * The catalog name of a connected server, or `custom`. A server counts as a catalog server only
 * when it carries the catalog name and was installed from the catalog or launches exactly as the
 * catalog entry does, so a user's own server that happens to share a name stays `custom`.
 */
export function usageStatisticsMcpServerIdentifier(server: {
  readonly name: string
  readonly definition: McpServerDefinition
}) {
  const entry = MCP_CATALOG_SERVERS.find((candidate) => candidate.name === server.name)
  if (!entry || !USAGE_STATISTICS_CATALOG_MCP_SERVERS.includes(entry.name)) {
    return USAGE_STATISTICS_CUSTOM_IDENTIFIER
  }
  return server.definition.provenance?.source === 'catalog' ||
    sameLaunch(server.definition, entry.definition)
    ? entry.name
    : USAGE_STATISTICS_CUSTOM_IDENTIFIER
}
