/**
 * How Pi names MCP tools, shared by the main process (Agent definition allowlists) and the
 * renderer (transcript rows). Pi names an MCP tool `mcp__<namespace>__<tool>`.
 */

/** Pi's tools that reach MCP servers without being an MCP tool themselves. */
export const MCP_SERVER_REACH_TOOL_NAMES = [
  'tool_search',
  'list_mcp_resources',
  'list_mcp_resource_templates',
  'read_mcp_resource',
] as const

const MCP_TOOL_PREFIX = 'mcp__'
const MCP_NAME_SEPARATOR = '__'

interface McpToolName {
  /** The server's Pi namespace without the `mcp__` prefix, such as `chrome_devtools`. */
  readonly server: string
  readonly tool: string
}

/** Splits `mcp__<namespace>__<tool>` at the first `__` after the prefix. Null for anything else. */
export function parseMcpToolName(name: string): McpToolName | null {
  if (!name.startsWith(MCP_TOOL_PREFIX)) return null
  const separator = name.indexOf(MCP_NAME_SEPARATOR, MCP_TOOL_PREFIX.length)
  if (separator <= MCP_TOOL_PREFIX.length) return null
  const tool = name.slice(separator + MCP_NAME_SEPARATOR.length)
  if (!tool) return null
  return { server: name.slice(MCP_TOOL_PREFIX.length, separator), tool }
}

export function isMcpServerReachToolName(name: string) {
  return MCP_SERVER_REACH_TOOL_NAMES.some((tool) => tool === name)
}
