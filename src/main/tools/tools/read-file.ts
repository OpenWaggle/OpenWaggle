import fs from 'node:fs/promises'
import { z } from 'zod'
import { defineHiveCodeTool, resolveProjectPath } from '../define-tool'

export const readFileTool = defineHiveCodeTool({
  name: 'readFile',
  description:
    'Read the contents of a file at the given path relative to the project root. Returns the file content as text. Use this to understand existing code before making changes.',
  inputSchema: z.object({
    path: z.string().describe('File path relative to the project root'),
    maxLines: z
      .number()
      .optional()
      .describe('Maximum number of lines to read. If omitted, reads the entire file.'),
  }),
  async execute(args, context) {
    const filePath = resolveProjectPath(context.projectPath, args.path)
    const content = await fs.readFile(filePath, 'utf-8')
    if (args.maxLines) {
      const lines = content.split('\n')
      const truncated = lines.slice(0, args.maxLines).join('\n')
      if (lines.length > args.maxLines) {
        return `${truncated}\n\n... (${lines.length - args.maxLines} more lines)`
      }
      return truncated
    }
    return content
  },
})
