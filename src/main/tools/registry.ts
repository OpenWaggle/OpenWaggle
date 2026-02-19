import type { ServerTool } from '@tanstack/ai'
import { askUserTool } from './tools/ask-user'
import { editFileTool } from './tools/edit-file'
import { globTool } from './tools/glob'
import { listFilesTool } from './tools/list-files'
import { readFileTool } from './tools/read-file'
import { runCommandTool } from './tools/run-command'
import { writeFileTool } from './tools/write-file'

const tools: ServerTool[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  runCommandTool,
  globTool,
  listFilesTool,
  askUserTool,
]

export function getServerTools(): ServerTool[] {
  return tools
}
