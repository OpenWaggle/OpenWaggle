import { Schema } from '@shared/schema'
import fg from 'fast-glob'
import { defineOpenWaggleTool } from '../define-tool'

const EXECUTE_VALUE_200 = 200
const SLICE_ARG_2 = 200

export const globTool = defineOpenWaggleTool({
  name: 'glob',
  description:
    'Find files matching a glob pattern. Returns matching file paths. Useful for discovering project structure and finding files.',
  inputSchema: Schema.Struct({
    pattern: Schema.String.annotations({
      description: 'Glob pattern (e.g., "**/*.ts", "src/**/*.tsx", "*.json")',
    }),
    path: Schema.optional(
      Schema.NullOr(
        Schema.String.annotations({
          description:
            'Base directory to search in. Defaults to the project root. Use an absolute path to search outside the project.',
        }),
      ),
    ),
    ignore: Schema.optional(
      Schema.NullOr(
        Schema.Array(Schema.String).annotations({
          description: 'Patterns to ignore (e.g., ["node_modules/**", "dist/**"])',
        }),
      ),
    ),
  }),
  async execute(args, context) {
    const cwd = args.path ?? context.projectPath

    const files = await fg(args.pattern, {
      cwd,
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
