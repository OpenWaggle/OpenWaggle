import type { ServerTool } from '@tanstack/ai'
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

export const builtInTools: readonly ServerTool[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  runCommandTool,
  globTool,
  listFilesTool,
  loadAgentsTool,
  loadSkillTool,
  askUserTool,
  proposePlanTool,
  orchestrateTool,
  webFetchTool,
  spawnAgentTool,
  teamCreateTool,
  teamDeleteTool,
  taskCreateTool,
  taskUpdateTool,
  taskListTool,
  taskGetTool,
  sendMessageTool,
]
