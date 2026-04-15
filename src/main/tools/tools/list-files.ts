import fs from 'node:fs/promises'
import path from 'node:path'
import { TRIPLE_FACTOR } from '@shared/constants/math'
import { BYTES_PER_KIBIBYTE } from '@shared/constants/resource-limits'
import { Schema } from '@shared/schema'
import { defineOpenWaggleTool, resolvePath } from '../define-tool'

export const listFilesTool = defineOpenWaggleTool({
  name: 'listFiles',
  description:
    'List files and directories in a given path. Shows file types and sizes. Useful for exploring project structure and files outside the project.',
  inputSchema: Schema.Struct({
    path: Schema.optional(
      Schema.NullOr(
        Schema.String.annotations({
          description:
            'Directory path relative to the project root, or an absolute path. Defaults to the project root.',
        }),
      ),
    ),
    recursive: Schema.optional(
      Schema.NullOr(
        Schema.Boolean.annotations({
          description: 'If true, list files recursively (max depth 3). Defaults to false.',
        }),
      ),
    ),
  }),
  async execute(args, context) {
    const dirPath = resolvePath(context.projectPath, args.path ?? '.')

    async function listDir(dir: string, depth: number): Promise<string[]> {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      const lines: string[] = []
      const indent = '  '.repeat(depth)

      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue

        if (entry.isDirectory()) {
          lines.push(`${indent}${entry.name}/`)
          if (args.recursive && depth < TRIPLE_FACTOR) {
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
  if (bytes < BYTES_PER_KIBIBYTE) return `${bytes}B`
  if (bytes < BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE)
    return `${(bytes / BYTES_PER_KIBIBYTE).toFixed(1)}KB`
  return `${(bytes / (BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE)).toFixed(1)}MB`
}
