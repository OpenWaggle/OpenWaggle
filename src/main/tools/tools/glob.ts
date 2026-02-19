import fg from 'fast-glob'
import { z } from 'zod'
import { defineOpenHiveTool } from '../define-tool'

export const globTool = defineOpenHiveTool({
  name: 'glob',
  description:
    'Find files matching a glob pattern within the project directory. Returns matching file paths. Useful for discovering project structure and finding files.',
  inputSchema: z.object({
    pattern: z.string().describe('Glob pattern (e.g., "**/*.ts", "src/**/*.tsx", "*.json")'),
    ignore: z
      .array(z.string())
      .optional()
      .describe('Patterns to ignore (e.g., ["node_modules/**", "dist/**"])'),
  }),
  async execute(args, context) {
    const files = await fg(args.pattern, {
      cwd: context.projectPath,
      ignore: args.ignore ?? ['node_modules/**', '.git/**', 'dist/**', 'out/**'],
      dot: false,
      onlyFiles: true,
    })

    if (files.length === 0) {
      return 'No files found matching the pattern.'
    }

    const sorted = files.sort()
    if (sorted.length > 200) {
      return `${sorted.slice(0, 200).join('\n')}\n\n... and ${sorted.length - 200} more files`
    }
    return sorted.join('\n')
  },
})
