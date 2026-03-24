import { askUserTool } from './tools/ask-user'
import { editFileTool } from './tools/edit-file'
import { globTool } from './tools/glob'
import { listFilesTool } from './tools/list-files'
import { loadAgentsTool } from './tools/load-agents'
import { loadSkillTool } from './tools/load-skill'
import { orchestrateTool } from './tools/orchestrate'
import { proposePlanTool } from './tools/propose-plan'
import { readFileTool } from './tools/read-file'
import { runCommandTool } from './tools/run-command'
import { sendMessageTool } from './tools/send-message'
import { spawnAgentTool } from './tools/spawn-agent'
import { taskCreateTool } from './tools/task-create'
import { taskGetTool } from './tools/task-get'
import { taskListTool } from './tools/task-list'
import { taskUpdateTool } from './tools/task-update'
import { teamCreateTool } from './tools/team-create'
import { teamDeleteTool } from './tools/team-delete'
import { webFetchTool } from './tools/web-fetch'
import { writeFileTool } from './tools/write-file'

/**
 * Tools that require user approval before execution (needsApproval: true).
 * These mutate files, run arbitrary commands, or make network requests.
 *
 * `ApprovalRequiredToolName` is derived from this array — adding or
 * removing a tool here automatically updates the type.
 */
export const approvalRequiredTools = [
  writeFileTool,
  editFileTool,
  runCommandTool,
  webFetchTool,
] as const

/**
 * Tools that execute without approval. Includes read-only tools,
 * user interaction, orchestration, and internal coordination.
 */
export const safeTools = [
  readFileTool,
  globTool,
  listFilesTool,
  loadAgentsTool,
  loadSkillTool,
  askUserTool,
  proposePlanTool,
  orchestrateTool,
  spawnAgentTool,
  teamCreateTool,
  teamDeleteTool,
  taskCreateTool,
  taskUpdateTool,
  taskListTool,
  taskGetTool,
  sendMessageTool,
] as const

/**
 * All built-in tools. The const tuple preserves each tool's literal name type.
 *
 * To add a new tool: create the file in `tools/`, call `defineOpenWaggleTool`,
 * and add it to the appropriate array above (`approvalRequiredTools` or `safeTools`).
 * Both `BuiltInToolName` and `ApprovalRequiredToolName` update automatically.
 */
export const builtInTools = [...approvalRequiredTools, ...safeTools] as const

/** Union of all built-in tool name literals. */
export type BuiltInToolName = (typeof builtInTools)[number]['name']

/** Union of tool names that require user approval. */
export type ApprovalRequiredToolName = (typeof approvalRequiredTools)[number]['name']
