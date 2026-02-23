import fs from 'node:fs/promises'
import path from 'node:path'
import { isPathInside } from '@shared/utils/paths'
import type { ServerTool } from '@tanstack/ai'
import { toolDefinition } from '@tanstack/ai'
import fg from 'fast-glob'
import { z } from 'zod'
import { createLogger } from '../logger'
import { readBodyWithLimit, stripHtml } from '../utils/http'

const logger = createLogger('orchestration:context')

export interface ProjectContext {
  readonly text: string
  readonly rawLength: number
  readonly durationMs: number
}

const TECH_STACK_BUDGET = 500
const KEY_FILES_BUDGET = 3000
const TREE_BUDGET = 1500
const PER_FILE_CAP = 1500

const TREE_IGNORE = ['node_modules/**', '.git/**', 'dist/**', 'out/**', 'build/**', 'coverage/**']

const KNOWN_FRAMEWORKS: ReadonlyArray<readonly [string, string]> = [
  ['react', 'React'],
  ['next', 'Next.js'],
  ['vue', 'Vue'],
  ['nuxt', 'Nuxt'],
  ['svelte', 'Svelte'],
  ['angular', 'Angular'],
  ['electron', 'Electron'],
  ['express', 'Express'],
  ['fastify', 'Fastify'],
  ['hono', 'Hono'],
  ['tailwindcss', 'Tailwind CSS'],
  ['zustand', 'Zustand'],
  ['redux', 'Redux'],
  ['prisma', 'Prisma'],
  ['drizzle-orm', 'Drizzle'],
]

export async function gatherProjectContext(projectPath: string | null): Promise<ProjectContext> {
  if (!projectPath) {
    return { text: '', rawLength: 0, durationMs: 0 }
  }

  const start = Date.now()

  const [techStack, keyFiles, tree] = await Promise.all([
    buildTechStack(projectPath),
    buildKeyFiles(projectPath),
    buildTree(projectPath),
  ])

  const sections: string[] = ['## Project Context', '']

  if (techStack) {
    sections.push('### Tech Stack', techStack, '')
  }

  if (keyFiles) {
    sections.push('### Key Files', keyFiles, '')
  }

  if (tree) {
    sections.push('### File Structure', tree, '')
  }

  const text = sections.length > 2 ? sections.join('\n').trim() : ''
  const durationMs = Date.now() - start

  logger.debug('project context gathered', {
    chars: text.length,
    durationMs,
  })

  return { text, rawLength: text.length, durationMs }
}

async function buildTechStack(projectPath: string): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8')
    const pkg = JSON.parse(raw) as Record<string, unknown>

    const lines: string[] = []

    const name = typeof pkg.name === 'string' ? pkg.name : null
    const description = typeof pkg.description === 'string' ? pkg.description : null
    if (name) {
      lines.push(`Project: ${name}${description ? ` — ${description}` : ''}`)
    }

    const allDeps = {
      ...(pkg.dependencies && typeof pkg.dependencies === 'object'
        ? (pkg.dependencies as Record<string, string>)
        : {}),
      ...(pkg.devDependencies && typeof pkg.devDependencies === 'object'
        ? (pkg.devDependencies as Record<string, string>)
        : {}),
    }

    const detected: string[] = []
    for (const [key, label] of KNOWN_FRAMEWORKS) {
      if (key in allDeps) {
        detected.push(label)
      }
    }

    let hasTypeScript = false
    try {
      await fs.access(path.join(projectPath, 'tsconfig.json'))
      hasTypeScript = true
    } catch {
      // not typescript
    }
    if (hasTypeScript) {
      detected.unshift('TypeScript')
    }

    if (detected.length > 0) {
      lines.push(`Stack: ${detected.join(', ')}`)
    }

    const buildTool = detectBuildTool(allDeps)
    if (buildTool) {
      lines.push(`Build: ${buildTool}`)
    }

    const result = lines.join('\n')
    return result.length > TECH_STACK_BUDGET ? result.slice(0, TECH_STACK_BUDGET) : result
  } catch {
    return ''
  }
}

function detectBuildTool(deps: Record<string, string>): string | null {
  if ('electron-vite' in deps) return 'electron-vite'
  if ('vite' in deps) return 'Vite'
  if ('webpack' in deps) return 'Webpack'
  if ('esbuild' in deps) return 'esbuild'
  if ('rollup' in deps) return 'Rollup'
  if ('turbopack' in deps) return 'Turbopack'
  return null
}

async function buildKeyFiles(projectPath: string): Promise<string> {
  const candidates = [
    { glob: '[Rr][Ee][Aa][Dd][Mm][Ee].[Mm][Dd]', label: 'README.md' },
    { glob: 'CLAUDE.md', label: 'CLAUDE.md' },
    { glob: 'AGENTS.md', label: 'AGENTS.md' },
  ]

  const sections: string[] = []
  let totalChars = 0

  for (const { glob, label } of candidates) {
    if (totalChars >= KEY_FILES_BUDGET) break

    try {
      const matches = await fg(glob, { cwd: projectPath, onlyFiles: true, deep: 1 })
      if (matches.length === 0) continue

      const filePath = path.join(projectPath, matches[0])
      let content = await fs.readFile(filePath, 'utf-8')

      const remaining = KEY_FILES_BUDGET - totalChars
      const cap = Math.min(PER_FILE_CAP, remaining)
      if (content.length > cap) {
        content = `${content.slice(0, cap)}...`
      }

      sections.push(`--- ${label} ---`, content)
      totalChars += content.length
    } catch {
      // skip unreadable files
    }
  }

  // package.json summary (scripts only, not full deps)
  if (totalChars < KEY_FILES_BUDGET) {
    try {
      const raw = await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8')
      const pkg = JSON.parse(raw) as Record<string, unknown>
      const summary: Record<string, unknown> = {}
      if (pkg.name) summary.name = pkg.name
      if (pkg.description) summary.description = pkg.description
      if (pkg.scripts) summary.scripts = pkg.scripts

      let content = JSON.stringify(summary, null, 2)
      const remaining = KEY_FILES_BUDGET - totalChars
      const cap = Math.min(PER_FILE_CAP, remaining)
      if (content.length > cap) {
        content = `${content.slice(0, cap)}...`
      }

      sections.push('--- package.json (summary) ---', content)
    } catch {
      // skip
    }
  }

  return sections.join('\n')
}

async function buildTree(projectPath: string): Promise<string> {
  try {
    const files = await fg('**/*', {
      cwd: projectPath,
      deep: 3,
      onlyFiles: true,
      ignore: TREE_IGNORE,
    })

    if (files.length === 0) return ''

    const sorted = files.sort()
    const lines: string[] = []
    let chars = 0

    for (const file of sorted) {
      const line = file
      if (chars + line.length + 1 > TREE_BUDGET) {
        const remaining = sorted.length - lines.length
        lines.push(`... and ${String(remaining)} more files`)
        break
      }
      lines.push(line)
      chars += line.length + 1
    }

    return lines.join('\n')
  } catch {
    return ''
  }
}

const MAX_READ_SIZE = 512 * 1024 // 512 KB
const MAX_READ_LINES = 500

/**
 * Create read-only tools for orchestration executors.
 * These tools let executor LLMs dynamically explore project files
 * without requiring the full ToolContext (AsyncLocalStorage).
 */
export function createExecutorTools(
  projectPath: string | null,
  signal?: AbortSignal,
): ServerTool[] {
  if (!projectPath) return []

  const readFile = toolDefinition({
    name: 'readFile',
    description:
      'Read a file from the project. Use this to gather additional context about the codebase when the provided project context is insufficient.',
    inputSchema: z.object({
      path: z.string().describe('File path relative to the project root'),
    }),
  }).server(async (args: { path: string }) => {
    const resolved = path.resolve(projectPath, args.path)
    if (!isPathInside(projectPath, resolved)) {
      return { kind: 'text' as const, text: 'Error: path is outside the project directory' }
    }

    try {
      const stat = await fs.stat(resolved)
      if (stat.size > MAX_READ_SIZE) {
        return {
          kind: 'text' as const,
          text: `File too large (${(stat.size / 1024).toFixed(0)} KB). Try a more specific file.`,
        }
      }

      const content = await fs.readFile(resolved, 'utf-8')
      const lines = content.split('\n')
      if (lines.length > MAX_READ_LINES) {
        return {
          kind: 'text' as const,
          text: `${lines.slice(0, MAX_READ_LINES).join('\n')}\n\n... (${String(lines.length - MAX_READ_LINES)} more lines)`,
        }
      }
      return { kind: 'text' as const, text: content }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { kind: 'text' as const, text: `Error reading file: ${msg}` }
    }
  })

  const glob = toolDefinition({
    name: 'glob',
    description:
      'Find files matching a glob pattern in the project. Use this to discover project structure and locate relevant files.',
    inputSchema: z.object({
      pattern: z.string().describe('Glob pattern (e.g., "**/*.ts", "src/**/*.tsx")'),
    }),
  }).server(async (args: { pattern: string }) => {
    const normalized = args.pattern.replaceAll('\\', '/')
    if (path.isAbsolute(args.pattern) || normalized.split('/').includes('..')) {
      return { kind: 'text' as const, text: 'Error: pattern must be relative to the project root' }
    }

    try {
      const files = await fg(args.pattern, {
        cwd: projectPath,
        ignore: TREE_IGNORE,
        onlyFiles: true,
        dot: false,
      })

      if (files.length === 0) {
        return { kind: 'text' as const, text: 'No files found matching the pattern.' }
      }

      const sorted = files.sort()
      if (sorted.length > 100) {
        return {
          kind: 'text' as const,
          text: `${sorted.slice(0, 100).join('\n')}\n\n... and ${String(sorted.length - 100)} more files`,
        }
      }
      return { kind: 'text' as const, text: sorted.join('\n') }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { kind: 'text' as const, text: `Error running glob: ${msg}` }
    }
  })

  const webFetch = toolDefinition({
    name: 'webFetch',
    description:
      'Fetch the content of a URL and return it as text. HTML is stripped to plain text. Use this to look up documentation, APIs, or any web content.',
    inputSchema: z.object({
      url: z.string().describe('The URL to fetch (must be a valid http/https URL)'),
      maxLength: z
        .number()
        .optional()
        .describe('Maximum character length of the returned text (default 50000)'),
    }),
  }).server(async (args: { url: string; maxLength?: number }) => {
    const maxLength = args.maxLength ?? 50_000
    const maxBodyBytes = 5 * 1024 * 1024 // 5 MB

    try {
      const fetchSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000)
      const response = await fetch(args.url, {
        headers: { 'User-Agent': 'OpenHive/1.0' },
        signal: fetchSignal,
      })

      if (!response.ok) {
        return {
          kind: 'text' as const,
          text: `HTTP ${String(response.status)} ${response.statusText} for ${args.url}`,
        }
      }

      const contentType = response.headers.get('content-type') ?? ''
      const raw = await readBodyWithLimit(response, maxBodyBytes)

      let text = contentType.includes('text/html') ? stripHtml(raw) : raw

      if (text.length > maxLength) {
        text = `${text.slice(0, maxLength)}\n\n... [truncated — ${String(text.length)} chars total, showing first ${String(maxLength)}]`
      }

      return { kind: 'text' as const, text }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { kind: 'text' as const, text: `Error fetching URL: ${msg}` }
    }
  })

  return [readFile, glob, webFetch]
}
