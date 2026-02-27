import fs from 'node:fs/promises'
import path from 'node:path'
import { packageJsonSchema } from '@shared/schemas/validation'
import type { JsonObject } from '@shared/types/json'
import { parseJsonSafe } from '@shared/utils/parse-json'
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

interface DetectionSignal {
  readonly label: string
  readonly patterns: readonly string[]
}

const ECOSYSTEM_SIGNALS: readonly DetectionSignal[] = [
  { label: 'JavaScript/Node.js', patterns: ['**/package.json'] },
  { label: 'TypeScript', patterns: ['**/tsconfig.json'] },
  { label: 'Python', patterns: ['**/pyproject.toml', '**/requirements.txt', '**/Pipfile'] },
  { label: 'Rust', patterns: ['**/Cargo.toml'] },
  { label: 'Go', patterns: ['**/go.mod'] },
  { label: 'Java/Kotlin', patterns: ['**/pom.xml', '**/build.gradle', '**/build.gradle.kts'] },
  { label: 'Ruby', patterns: ['**/Gemfile'] },
  { label: 'PHP', patterns: ['**/composer.json'] },
  { label: 'Swift', patterns: ['**/Package.swift'] },
  { label: 'C#/.NET', patterns: ['**/*.sln', '**/*.csproj'] },
]

const BUILD_TOOL_SIGNALS: readonly DetectionSignal[] = [
  {
    label: 'electron-vite',
    patterns: [
      '**/electron.vite.config.ts',
      '**/electron.vite.config.js',
      '**/electron.vite.config.mjs',
      '**/electron.vite.config.cjs',
    ],
  },
  {
    label: 'Vite',
    patterns: [
      '**/vite.config.ts',
      '**/vite.config.js',
      '**/vite.config.mjs',
      '**/vite.config.cjs',
    ],
  },
  {
    label: 'Webpack',
    patterns: [
      '**/webpack.config.ts',
      '**/webpack.config.js',
      '**/webpack.config.mjs',
      '**/webpack.config.cjs',
    ],
  },
  {
    label: 'Rollup',
    patterns: [
      '**/rollup.config.ts',
      '**/rollup.config.js',
      '**/rollup.config.mjs',
      '**/rollup.config.cjs',
    ],
  },
  {
    label: 'esbuild',
    patterns: [
      '**/esbuild.config.ts',
      '**/esbuild.config.js',
      '**/esbuild.config.mjs',
      '**/esbuild.config.cjs',
    ],
  },
  { label: 'Turborepo', patterns: ['**/turbo.json'] },
]

const PACKAGE_MANAGER_SIGNALS: readonly DetectionSignal[] = [
  { label: 'pnpm', patterns: ['**/pnpm-lock.yaml'] },
  { label: 'npm', patterns: ['**/package-lock.json'] },
  { label: 'yarn', patterns: ['**/yarn.lock'] },
  { label: 'bun', patterns: ['**/bun.lock', '**/bun.lockb'] },
  { label: 'Cargo', patterns: ['**/Cargo.lock'] },
  { label: 'Go', patterns: ['**/go.sum'] },
  { label: 'Poetry', patterns: ['**/poetry.lock'] },
  { label: 'uv', patterns: ['**/uv.lock'] },
  { label: 'Pipenv', patterns: ['**/Pipfile.lock'] },
]

/**
 * Parse `.gitignore` into fast-glob ignore patterns.
 * Falls back to `['.git/**']` when no `.gitignore` exists.
 */
export async function buildIgnorePatterns(projectPath: string): Promise<string[]> {
  const patterns: string[] = ['.git/**']

  try {
    const raw = await fs.readFile(path.join(projectPath, '.gitignore'), 'utf-8')
    for (const rawLine of raw.split('\n')) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#') || line.startsWith('!')) continue

      if (line.endsWith('/')) {
        // Directory pattern → match everything inside
        patterns.push(`${line}**`)
      } else if (line.startsWith('/')) {
        // Root-anchored → strip leading slash (already relative)
        patterns.push(line.slice(1))
      } else if (!line.includes('/')) {
        // Unanchored filename/glob → match anywhere in tree
        patterns.push(`**/${line}`)
      } else {
        // Already a relative path with directory component
        patterns.push(line)
      }
    }
  } catch {
    // No .gitignore — default is just .git/**
  }

  return patterns
}

async function detectSignals(
  projectPath: string,
  signals: readonly DetectionSignal[],
): Promise<string[]> {
  const labels: string[] = []
  for (const signal of signals) {
    const matches = await fg([...signal.patterns], {
      cwd: projectPath,
      onlyFiles: true,
      deep: 2,
    })
    if (matches.length > 0) {
      labels.push(signal.label)
    }
  }
  return labels
}

export async function gatherProjectContext(projectPath: string | null): Promise<ProjectContext> {
  if (!projectPath) {
    return { text: '', rawLength: 0, durationMs: 0 }
  }

  const start = Date.now()
  const ignorePatterns = await buildIgnorePatterns(projectPath)

  const [techStack, keyFiles, tree] = await Promise.all([
    buildTechStack(projectPath),
    buildKeyFiles(projectPath),
    buildTree(projectPath, ignorePatterns),
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
    const [ecosystems, buildTools, packageManagers] = await Promise.all([
      detectSignals(projectPath, ECOSYSTEM_SIGNALS),
      detectSignals(projectPath, BUILD_TOOL_SIGNALS),
      detectSignals(projectPath, PACKAGE_MANAGER_SIGNALS),
    ])

    const lines: string[] = []

    // Include project name/description from package.json if available
    try {
      const raw = await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8')
      const parsed = parseJsonSafe(raw, packageJsonSchema)
      if (parsed.success && parsed.data.name) {
        const desc = parsed.data.description ? ` — ${parsed.data.description}` : ''
        lines.push(`Project: ${parsed.data.name}${desc}`)
      }
    } catch {
    // No package.json — skip project line
    }

    if (ecosystems.length > 0) {
      lines.push(`Ecosystem: ${ecosystems.join(', ')}`)
    }
    if (buildTools.length > 0) {
      lines.push(`Build: ${buildTools.join(', ')}`)
    }
    if (packageManagers.length > 0) {
      lines.push(`Package manager: ${packageManagers.join(', ')}`)
    }

    const result = lines.join('\n')
    return result.length > TECH_STACK_BUDGET ? result.slice(0, TECH_STACK_BUDGET) : result
  } catch {
    return ''
  }
}

async function buildKeyFiles(projectPath: string): Promise<string> {
  const readmeCandidates = [{ glob: '[Rr][Ee][Aa][Dd][Mm][Ee].[Mm][Dd]', label: 'README.md' }]
  const referenceCandidates = [
    { glob: 'AGENTS.md', label: 'AGENTS.md' }
  ]

  const sections: string[] = []
  let totalChars = 0

  const appendFileByGlob = async (glob: string, label: string): Promise<void> => {
    if (totalChars >= KEY_FILES_BUDGET) return

    try {
      const matches = await fg(glob, { cwd: projectPath, onlyFiles: true, deep: 1 })
      if (matches.length === 0) return

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

  for (const { glob, label } of readmeCandidates) {
    await appendFileByGlob(glob, label)
  }

  // package.json summary (scripts only, not full deps)
  if (totalChars < KEY_FILES_BUDGET) {
    try {
      const raw = await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8')
      const pkgResult = parseJsonSafe(raw, packageJsonSchema)
      if (!pkgResult.success) throw new Error('invalid package.json')
      const pkg = pkgResult.data
      const summary: JsonObject = {}
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
      totalChars += content.length
    } catch {
      // skip
    }
  }

  for (const { glob, label } of referenceCandidates) {
    await appendFileByGlob(glob, label)
  }

  return sections.join('\n')
}

async function buildTree(projectPath: string, ignorePatterns: string[]): Promise<string> {
  try {
    const files = await fg('**/*', {
      cwd: projectPath,
      deep: 3,
      onlyFiles: true,
      ignore: ignorePatterns,
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
  ignorePatterns?: string[],
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
        ignore: ignorePatterns ?? ['.git/**'],
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
        headers: { 'User-Agent': 'OpenWaggle/1.0' },
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
