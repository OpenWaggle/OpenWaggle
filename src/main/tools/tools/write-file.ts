import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { defineHiveCodeTool, resolveProjectPath } from '../define-tool'

export const writeFileTool = defineHiveCodeTool({
  name: 'writeFile',
  description:
    "Write content to a file at the given path relative to the project root. Creates the file and any parent directories if they don't exist. Overwrites the file if it already exists.",
  needsApproval: true,
  inputSchema: z.object({
    path: z.string().describe('File path relative to the project root'),
    content: z.string().describe('Content to write to the file'),
  }),
  async execute(args, context) {
    const filePath = resolveProjectPath(context.projectPath, args.path)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, args.content, 'utf-8')
    return `File written: ${args.path}`
  },
})
