import type { ServerTool } from '@tanstack/ai'
import { askUserTool } from './tools/ask-user'
import { editFileTool } from './tools/edit-file'
import { globTool } from './tools/glob'
import { listFilesTool } from './tools/list-files'
import { loadAgentsTool } from './tools/load-agents'
import { loadSkillTool } from './tools/load-skill'
import { readFileTool } from './tools/read-file'
import { runCommandTool } from './tools/run-command'
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
  webFetchTool,
]
