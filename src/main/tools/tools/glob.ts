import path from 'node:path'
import { Schema } from '@shared/schema'
import fg from 'fast-glob'
import { defineOpenWaggleTool } from '../define-tool'

const EXECUTE_VALUE_200 = 200
const SLICE_ARG_2 = 200

export const globTool = defineOpenWaggleTool({
  name: 'glob',
  description:
    'Find files matching a glob pattern within the project directory. Returns matching file paths. Useful for discovering project structure and finding files.',
  inputSchema: Schema.Struct({
    pattern: Schema.String.annotations({
      description: 'Glob pattern (e.g., "**/*.ts", "src/**/*.tsx", "*.json")',
    }),
    ignore: Schema.optional(
      Schema.NullOr(
        Schema.Array(Schema.String).annotations({
          description: 'Patterns to ignore (e.g., ["node_modules/**", "dist/**"])',
        }),
      ),
    ),
  }),
  async execute(args, context) {
    assertPatternInsideProject(args.pattern)

    const files = await fg(args.pattern, {
      cwd: context.projectPath,
      ignore: [...(args.ignore ?? ['node_modules/**', '.git/**', 'dist/**', 'out/**'])],
      dot: false,
      onlyFiles: true,
    })

    if (files.length === 0) {
      return 'No files found matching the pattern.'
    }

    const sorted = files.sort()
    if (sorted.length > EXECUTE_VALUE_200) {
      return `${sorted.slice(0, SLICE_ARG_2).join('\n')}\n\n... and ${sorted.length - EXECUTE_VALUE_200} more files`
    }
    return sorted.join('\n')
  },
})

function assertPatternInsideProject(pattern: string): void {
  const normalized = pattern.replaceAll('\\', '/')
  if (path.isAbsolute(pattern) || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error('Glob pattern must be relative to the project root')
  }

  const segments = normalized.split('/').filter(Boolean)
  if (segments.includes('..')) {
    throw new Error('Glob pattern cannot traverse outside the project root')
  }
}
