/**
 * Which MCP servers Usage statistics may name: entries of OpenWaggle's curated catalog only, as
 * listed in src/shared/usage-statistics/catalog.generated.ts, which the endpoint enforces too.
 */
import { USAGE_STATISTICS_CATALOG_MCP_SERVERS } from '@shared/usage-statistics/catalog.generated'
import { USAGE_STATISTICS_CUSTOM_IDENTIFIER } from '@shared/usage-statistics/contract'

/** Pi names every MCP server tool `mcp__<server>__<tool>`. */
const PI_MCP_TOOL_PREFIX = 'mcp__'
const PI_MCP_TOOL_SEPARATOR = '__'

/**
 * The server a Pi MCP tool call reached, as a catalog name or `custom`; nothing when the tool is
 * not an MCP server tool. Only the name is known here, so a server named like a catalog entry
 * counts as that entry; a catalog name says nothing about the user's own setup.
 */
export function usageStatisticsMcpServerIdentifier(toolName: string) {
  if (!toolName.startsWith(PI_MCP_TOOL_PREFIX)) return undefined
  const rest = toolName.slice(PI_MCP_TOOL_PREFIX.length)
  const separator = rest.indexOf(PI_MCP_TOOL_SEPARATOR)
  if (separator <= 0 || separator + PI_MCP_TOOL_SEPARATOR.length >= rest.length) return undefined
  const server = rest.slice(0, separator)
  return USAGE_STATISTICS_CATALOG_MCP_SERVERS.includes(server)
    ? server
    : USAGE_STATISTICS_CUSTOM_IDENTIFIER
}
