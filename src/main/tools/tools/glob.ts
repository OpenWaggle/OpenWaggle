import path from 'node:path'
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
    assertPatternInsideProject(args.pattern)

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
