import fs from 'node:fs/promises'
import { BYTES_PER_KIBIBYTE } from '@shared/constants/constants'
import { Schema } from '@shared/schema'
import { defineOpenWaggleTool, resolveProjectPath } from '../define-tool'

const MAX_FILE_SIZE = BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE // 1 MB

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

export const readFileTool = defineOpenWaggleTool({
  name: 'readFile',
  description:
    'Read the contents of a file at the given path relative to the project root. Returns the file content as text. Use this to understand existing code before making changes.',
  inputSchema: Schema.Struct({
    path: Schema.String.annotations({ description: 'File path relative to the project root' }),
    maxLines: Schema.optional(
      Schema.Number.annotations({
        description: 'Maximum number of lines to read. If omitted, reads the entire file.',
      }),
    ),
  }),
  async execute(args, context) {
    const filePath = resolveProjectPath(context.projectPath, args.path)

    try {
      const stat = await fs.stat(filePath)
      if (stat.size > MAX_FILE_SIZE) {
        throw new Error(
          `File "${args.path}" is ${(stat.size / BYTES_PER_KIBIBYTE / BYTES_PER_KIBIBYTE).toFixed(1)} MB — exceeds 1 MB limit. Use maxLines or read a specific section.`,
        )
      }

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
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') {
        throw new Error(
          `File "${args.path}" was not found in the project. Run listFiles first to confirm the path.`,
        )
      }
      if (isErrnoException(error) && error.code === 'EISDIR') {
        throw new Error(`"${args.path}" is a directory, not a file.`)
      }
      throw error
    }
  },
})
