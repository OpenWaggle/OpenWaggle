import fs from 'node:fs/promises'
import { PERCENT_BASE } from '@shared/constants/math'
import { Schema } from '@shared/schema'
import { defineOpenWaggleTool, resolvePath } from '../define-tool'
import { buildFileMutationResult } from './file-mutation-result'

const SLICE_ARG_2 = 100

export const editFileTool = defineOpenWaggleTool({
  name: 'editFile',
  description:
    'Edit a file by replacing an exact string match with new content. The oldString must appear exactly once in the file. Read the file first to get the exact content to match.',
  needsApproval: true,
  inputSchema: Schema.Struct({
    path: Schema.String.annotations({
      description: 'File path relative to the project root, or an absolute path',
    }),
    oldString: Schema.String.annotations({
      description: 'The exact string to find and replace (must be unique in the file)',
    }),
    newString: Schema.String.annotations({ description: 'The replacement string' }),
  }),
  async execute(args, context) {
    const filePath = resolvePath(context.projectPath, args.path)
    const content = await fs.readFile(filePath, 'utf-8')

    const occurrences = content.split(args.oldString).length - 1
    if (occurrences === 0) {
      const lineCount = content.split('\n').length
      const preview =
        args.oldString.length > PERCENT_BASE
          ? `${args.oldString.slice(0, SLICE_ARG_2)}...`
          : args.oldString
      throw new Error(
        `String not found in ${args.path} (${lineCount} lines). ` +
          `Searched for: "${preview}". ` +
          `The old string must match exactly including whitespace and line breaks. ` +
          `Read the file first to verify the exact content.`,
      )
    }
    if (occurrences > 1) {
      throw new Error(
        `String found ${occurrences} times in ${args.path}. The old string must be unique. Include more surrounding context.`,
      )
    }

    const newContent = content.replace(args.oldString, args.newString)
    await fs.writeFile(filePath, newContent, 'utf-8')

    return buildFileMutationResult({
      path: args.path,
      beforeContent: content,
      afterContent: newContent,
      verb: 'edited',
    })
  },
})
