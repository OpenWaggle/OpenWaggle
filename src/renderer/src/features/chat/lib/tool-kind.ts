/**
 * What kind of tool a transcript row shows, so the row can carry an icon of that kind. The tool
 * name is Pi's; MCP tools are named `mcp__<namespace>__<tool>` as Pi names them.
 */
export type ToolKind =
  | 'subagents'
  | 'mcp'
  | 'script'
  | 'model'
  | 'shell'
  | 'read'
  | 'edit'
  | 'write'
  | 'grep'
  | 'find'
  | 'ls'
  | 'browser'
  | 'actions'
  | 'scm'
  | 'goals'
  | 'waggle'
  | 'other'

const MCP_TOOL_PREFIX = 'mcp__'
const MCP_NAME_SEPARATOR = '__'
const BROWSER_PREVIEW_TOOL_PREFIX = 'preview_'
/** The `models.*` calls a codemode script makes. */
const MODEL_CALL_PREFIX = 'models.'

/** Pi's tools that reach MCP servers without being an MCP tool themselves. */
const MCP_REACH_TOOL_NAMES: ReadonlySet<string> = new Set([
  'list_mcp_resources',
  'list_mcp_resource_templates',
  'read_mcp_resource',
  'tool_search',
])

const TOOL_KINDS_BY_NAME: ReadonlyMap<string, ToolKind> = new Map<string, ToolKind>([
  ['sessions', 'subagents'],
  ['codemode', 'script'],
  ['bash', 'shell'],
  ['powershell', 'shell'],
  ['read', 'read'],
  ['edit', 'edit'],
  ['write', 'write'],
  ['grep', 'grep'],
  ['find', 'find'],
  ['ls', 'ls'],
  ['project_actions', 'actions'],
  ['source_control', 'scm'],
  ['create_goal', 'goals'],
  ['get_goal', 'goals'],
  ['waggle_invoke', 'waggle'],
])

interface McpToolName {
  /** The server's Pi namespace without the `mcp__` prefix, such as `chrome_devtools`. */
  readonly server: string
  readonly tool: string
}

/**
 * Splits `mcp__<namespace>__<tool>` at the first `__` after the prefix, as the Agent definition
 * allowlist does. Null for anything else.
 */
export function parseMcpToolName(name: string): McpToolName | null {
  if (!name.startsWith(MCP_TOOL_PREFIX)) return null
  const separator = name.indexOf(MCP_NAME_SEPARATOR, MCP_TOOL_PREFIX.length)
  if (separator <= MCP_TOOL_PREFIX.length) return null
  const tool = name.slice(separator + MCP_NAME_SEPARATOR.length)
  if (!tool) return null
  return { server: name.slice(MCP_TOOL_PREFIX.length, separator), tool }
}

export function toolKind(name: string): ToolKind {
  const known = TOOL_KINDS_BY_NAME.get(name)
  if (known) return known
  if (MCP_REACH_TOOL_NAMES.has(name) || parseMcpToolName(name)) return 'mcp'
  if (name.startsWith(BROWSER_PREVIEW_TOOL_PREFIX)) return 'browser'
  if (name.startsWith(MODEL_CALL_PREFIX)) return 'model'
  return 'other'
}
