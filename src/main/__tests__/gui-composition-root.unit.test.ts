/**
 * The desktop window's composition root (A-F5): the modules the GUI process evaluates at startup
 * must not reach the Session Host's runtime. A static import from any of these roots to Pi, MCP,
 * the agent kernel, SQLite or the Host's dispatchers would load them in every window again.
 * Dynamic `import()` is how the window loads Pi-backed features on first use, so it is not
 * followed here.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const REPOSITORY_ROOT = path.resolve(__dirname, '../../..')
const MAIN_ROOT = path.join(REPOSITORY_ROOT, 'src/main')

/** What the GUI process evaluates while it starts: its entry and what that entry loads at once. */
const GUI_STARTUP_ROOTS = [
  'index.ts',
  'gui-runtime.ts',
  'gui-backend-startup.ts',
  'gui-desktop-services.ts',
  'ipc/handlers.ts',
  'ipc/agent-handler.ts',
  'ipc/startup-handler.ts',
  'usage-statistics/usage-statistics-gui.ts',
  'store/settings.ts',
] as const

const FORBIDDEN_MODULES: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  { label: 'the Session Host runtime', pattern: /^src\/main\/runtime(?:-[\w-]+)?\.ts$/u },
  { label: 'the MCP runtime layers', pattern: /^src\/main\/mcp-runtime-layers\.ts$/u },
  { label: 'the Host command dispatcher', pattern: /local-session-command-dispatcher\.ts$/u },
  { label: 'the Host UI dispatcher', pattern: /host-ui-request-dispatcher\.ts$/u },
  { label: 'the app database', pattern: /^src\/main\/services\/database-service\.ts$/u },
  { label: 'MCP adapters', pattern: /^src\/main\/adapters\/mcp\//u },
  { label: 'the agent kernel', pattern: /^src\/main\/adapters\/pi\/agent-kernel\//u },
  { label: 'the Pi SDK', pattern: /^package:@earendil-works\//u },
  { label: 'the MCP SDK', pattern: /^package:@modelcontextprotocol\//u },
  { label: 'SQLite', pattern: /^package:(?:better-sqlite3|@effect\/sql-sqlite-node)/u },
  { label: 'the embedding model', pattern: /^package:(?:@huggingface\/transformers|onnxruntime)/u },
]

const STATIC_IMPORT = /^\s*(?:import|export)\s+(?!type\s)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gmu
const TYPE_ONLY_NAMED_IMPORT = /^\s*import\s*\{([^}]*)\}\s*from/u
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '/index.ts'] as const

function importBase(fromFile: string, specifier: string) {
  if (specifier.startsWith('@shared/')) {
    return path.join(REPOSITORY_ROOT, 'src/shared', specifier.slice('@shared/'.length))
  }
  if (specifier.startsWith('.')) return path.resolve(path.dirname(fromFile), specifier)
  return null
}

function resolveImport(fromFile: string, specifier: string): string | null {
  const base = importBase(fromFile, specifier)
  if (base === null) return `package:${specifier}`
  for (const extension of ['', ...SOURCE_EXTENSIONS]) {
    const candidate = `${base}${extension}`
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

function isTypeOnly(statement: string) {
  const named = statement.match(TYPE_ONLY_NAMED_IMPORT)
  if (!named?.[1]) return false
  const names = named[1].split(',').filter((name) => name.trim() !== '')
  return names.length > 0 && names.every((name) => /^\s*type\s/u.test(name))
}

function staticImportGraph(roots: readonly string[]) {
  const parents = new Map<string, string | null>()
  const queue: string[] = []
  for (const root of roots) {
    const file = path.join(MAIN_ROOT, root)
    parents.set(file, null)
    queue.push(file)
  }
  while (queue.length > 0) {
    const file = queue.shift()
    if (!file) break
    if (file.startsWith('package:')) continue
    for (const match of readFileSync(file, 'utf8').matchAll(STATIC_IMPORT)) {
      const specifier = match[1]
      if (!specifier || isTypeOnly(match[0])) continue
      const resolved = resolveImport(file, specifier)
      if (!resolved || parents.has(resolved)) continue
      parents.set(resolved, file)
      queue.push(resolved)
    }
  }
  return parents
}

function displayName(file: string) {
  return file.startsWith('package:') ? file : path.relative(REPOSITORY_ROOT, file)
}

function importChain(parents: ReadonlyMap<string, string | null>, file: string) {
  const chain: string[] = []
  let current: string | null | undefined = file
  while (current) {
    chain.unshift(displayName(current))
    current = parents.get(current)
  }
  return chain.join(' -> ')
}

describe('the desktop window composition root (A-F5)', () => {
  const graph = staticImportGraph(GUI_STARTUP_ROOTS)

  it.each(FORBIDDEN_MODULES)('never statically loads $label', ({ pattern }) => {
    const reached = [...graph.keys()].filter((file) => pattern.test(displayName(file)))
    expect(reached.map((file) => importChain(graph, file))).toEqual([])
  })

  it('walks the real entry graph', () => {
    // A walker that resolves nothing would pass every rule above.
    expect(graph.size).toBeGreaterThan(GUI_STARTUP_ROOTS.length * 10)
    expect(graph.has(path.join(MAIN_ROOT, 'ipc/typed-ipc.ts'))).toBe(true)
  })
})
