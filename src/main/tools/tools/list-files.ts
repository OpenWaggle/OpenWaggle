import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { defineHiveCodeTool, resolveProjectPath } from '../define-tool'

export const listFilesTool = defineHiveCodeTool({
  name: 'listFiles',
  description:
    'List files and directories in a given path relative to the project root. Shows file types and sizes. Useful for exploring project structure.',
  inputSchema: z.object({
    path: z
      .string()
      .optional()
      .describe('Directory path relative to the project root. Defaults to the project root.'),
    recursive: z
      .boolean()
      .optional()
      .describe('If true, list files recursively (max depth 3). Defaults to false.'),
  }),
  async execute(args, context) {
    const dirPath = resolveProjectPath(context.projectPath, args.path ?? '.')

    async function listDir(dir: string, depth: number): Promise<string[]> {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      const lines: string[] = []
      const indent = '  '.repeat(depth)

      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue

        if (entry.isDirectory()) {
          lines.push(`${indent}${entry.name}/`)
          if (args.recursive && depth < 3) {
            const subLines = await listDir(path.join(dir, entry.name), depth + 1)
            lines.push(...subLines)
          }
        } else {
          const stat = await fs.stat(path.join(dir, entry.name))
          const size = formatSize(stat.size)
          lines.push(`${indent}${entry.name} (${size})`)
        }
      }
      return lines
    }

    const lines = await listDir(dirPath, 0)
    return lines.length > 0 ? lines.join('\n') : '(empty directory)'
  },
})

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
