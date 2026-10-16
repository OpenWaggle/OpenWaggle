import { isMcpServerReachToolName, parseMcpToolName } from '@shared/utils/mcp-tool-names'
import { CODEMODE_TOOL_NAME } from './codemode-tool-view'

/**
 * What kind of tool a transcript row shows, so the row can carry an icon of that kind. The tool
 * name is Pi's; MCP tools are named `mcp__<namespace>__<tool>` as Pi names them.
 */
export type ToolKind =
  | 'workers'
  | 'mcp'
  | 'script'
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

const BROWSER_PREVIEW_TOOL_PREFIX = 'preview_'

const TOOL_KINDS_BY_NAME: ReadonlyMap<string, ToolKind> = new Map<string, ToolKind>([
  ['sessions', 'workers'],
  [CODEMODE_TOOL_NAME, 'script'],
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
  // The goal tools of the pi-goal-x extension.
  ['create_goal', 'goals'],
  ['get_goal', 'goals'],
  ['update_goal', 'goals'],
  ['set_goal_tasks', 'goals'],
  ['update_goal_task', 'goals'],
  ['goal_question', 'goals'],
  ['goal_questionnaire', 'goals'],
  ['propose_goal_draft', 'goals'],
  ['waggle_invoke', 'waggle'],
])

/** A script's `models.*` calls are not tools and fall to `other`. */
export function toolKind(name: string): ToolKind {
  const known = TOOL_KINDS_BY_NAME.get(name)
  if (known) return known
  if (isMcpServerReachToolName(name) || parseMcpToolName(name)) return 'mcp'
  if (name.startsWith(BROWSER_PREVIEW_TOOL_PREFIX)) return 'browser'
  return 'other'
}
