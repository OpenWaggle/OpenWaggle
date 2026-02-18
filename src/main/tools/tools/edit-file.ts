import fs from 'node:fs/promises'
import { z } from 'zod'
import { defineHiveCodeTool, resolveProjectPath } from '../define-tool'

export const editFileTool = defineHiveCodeTool({
  name: 'editFile',
  description:
    'Edit a file by replacing an exact string match with new content. The oldString must appear exactly once in the file. Read the file first to get the exact content to match.',
  needsApproval: true,
  inputSchema: z.object({
    path: z.string().describe('File path relative to the project root'),
    oldString: z
      .string()
      .describe('The exact string to find and replace (must be unique in the file)'),
    newString: z.string().describe('The replacement string'),
  }),
  async execute(args, context) {
    const filePath = resolveProjectPath(context.projectPath, args.path)
    const content = await fs.readFile(filePath, 'utf-8')

    const occurrences = content.split(args.oldString).length - 1
    if (occurrences === 0) {
      throw new Error(`String not found in ${args.path}. Make sure the old string matches exactly.`)
    }
    if (occurrences > 1) {
      throw new Error(
        `String found ${occurrences} times in ${args.path}. The old string must be unique. Include more surrounding context.`,
      )
    }

    const newContent = content.replace(args.oldString, args.newString)
    await fs.writeFile(filePath, newContent, 'utf-8')

    return JSON.stringify({
      message: `File edited: ${args.path}`,
      beforeContent: content,
      afterContent: newContent,
    })
  },
})
