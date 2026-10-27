import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * Renderer startup loads two graphs before the first meaningful paint: the entry graph that
 * `index.html` preloads, and the launch route's chunk, which the entry starts loading at once
 * (renderer-load B1). Surfaces that only render after a click must stay behind a dynamic
 * `import()` so neither graph evaluates them (renderer-load B8). This test walks the static
 * import graph of the source, the same edges Rolldown follows to place modules in eager chunks,
 * so it fails on a stray static import or barrel re-export without a production build.
 */

const RENDERER_ROOT = path.resolve(import.meta.dirname, '../../src/renderer/src')
const SHARED_ROOT = path.resolve(RENDERER_ROOT, '../../shared')
const SOURCE_EXTENSIONS = ['.ts', '.tsx'] as const
const STATIC_IMPORT_PATTERN =
  /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:((?:[\w$]+\s*,\s*)?(?:\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?|[\w$]+))\s+from\s+)?['"]([^'"]+)['"]/g

function resolveFile(candidate: string) {
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  for (const extension of SOURCE_EXTENSIONS) {
    if (fs.existsSync(`${candidate}${extension}`)) return `${candidate}${extension}`
  }
  for (const extension of SOURCE_EXTENSIONS) {
    const index = path.join(candidate, `index${extension}`)
    if (fs.existsSync(index)) return index
  }
  return null
}

function resolveSpecifier(specifier: string, importer: string) {
  if (specifier.startsWith('@/')) return resolveFile(path.join(RENDERER_ROOT, specifier.slice(2)))
  if (specifier.startsWith('@shared/')) {
    return resolveFile(path.join(SHARED_ROOT, specifier.slice('@shared/'.length)))
  }
  if (specifier.startsWith('.')) return resolveFile(path.resolve(path.dirname(importer), specifier))
  return null
}

/** Whether every specifier in `{ ... }` is a `type` import, which the bundler erases. */
function isTypeOnlyClause(clause: string | undefined) {
  if (clause === undefined) return false
  const braces = /^\{([\s\S]*)\}$/.exec(clause.trim())
  if (!braces?.[1]) return false
  const specifiers = braces[1]
    .split(',')
    .map((specifier) => specifier.trim())
    .filter((specifier) => specifier.length > 0)
  return specifiers.length > 0 && specifiers.every((specifier) => specifier.startsWith('type '))
}

function staticImports(file: string) {
  const source = fs.readFileSync(file, 'utf8')
  const imports: string[] = []
  for (const match of source.matchAll(STATIC_IMPORT_PATTERN)) {
    const [, typeKeyword, clause, specifier] = match
    if (typeKeyword !== undefined || specifier === undefined || isTypeOnlyClause(clause)) continue
    const resolved = resolveSpecifier(specifier, file)
    if (resolved !== null) imports.push(resolved)
  }
  return imports
}

/**
 * A file route's component and everything only it imports leave the route file: TanStack Router's
 * `autoCodeSplitting` moves them into that route's lazy chunk. The root route is not split.
 */
function isCodeSplitRouteFile(file: string) {
  const relative = path.relative(path.join(RENDERER_ROOT, 'routes'), file)
  return (
    !relative.startsWith('..') &&
    !relative.includes(path.sep) &&
    !relative.startsWith('-') &&
    relative !== '__root.tsx'
  )
}

function staticGraph(entry: string) {
  const seen = new Set<string>()
  const queue = [path.join(RENDERER_ROOT, entry)]
  while (queue.length > 0) {
    const file = queue.shift()
    if (file === undefined || seen.has(file)) continue
    seen.add(file)
    if (!isCodeSplitRouteFile(file)) queue.push(...staticImports(file))
  }
  return new Set([...seen].map((file) => path.relative(RENDERER_ROOT, file)))
}

const DEFERRED_SHELL_SURFACES = [
  'features/session-summary/components/SessionSummaryHub.tsx',
  'features/session-summary/components/ChangeRequestComposer.tsx',
  'features/session-summary/components/ChangeRequestPanel.tsx',
  'features/session-summary/components/SessionResourceViewer.tsx',
  'features/project-actions/components/ProjectActionsSettings.tsx',
  'features/project-actions/components/ProjectActionsSurface.tsx',
  'features/project-actions/components/ActionRunPanel.tsx',
  'features/scheduled-tasks/components/ScheduledTasksPanel.tsx',
  'features/scheduled-tasks/components/ScheduledTaskEditor.tsx',
  'features/extensions/components/ExtensionRouteSurface.tsx',
  'features/extensions/components/ExtensionDialogSurface.tsx',
  'features/extensions/components/ExtensionSidePanelSurface.tsx',
  'features/git/components/CommitDialog.tsx',
  'features/git/components/CommitOrPushDialog.tsx',
  'shell/right-panel/AllPanelsSurface.tsx',
  'shell/right-panel/WorkspaceProjectActionsSurface.tsx',
  'shell/right-panel/WorkspaceScheduledTasksSurface.tsx',
] as const

const DEFERRED_CHAT_SURFACES = [
  ...DEFERRED_SHELL_SURFACES,
  'routes/-chat-route-sidebar.tsx',
  'features/mcp/McpAppHost.tsx',
  'features/command-palette/components/GlobalCommandPalette.tsx',
  'features/workspace-files/components/index.ts',
  'features/hive-panel/components/index.ts',
] as const

describe('renderer startup import graph', () => {
  it('keeps on-demand surfaces out of the eager shell graph', () => {
    const graph = staticGraph('main.tsx')

    expect(graph.has('shell/WorkspaceShell.tsx')).toBe(true)
    expect(DEFERRED_SHELL_SURFACES.filter((surface) => graph.has(surface))).toEqual([])
  })

  it('keeps on-demand surfaces out of the launch chat route chunk', () => {
    const graph = staticGraph('routes/-chat-index-route-view.tsx')

    expect(graph.has('routes/-chat-route-surface.tsx')).toBe(true)
    expect(graph.has('features/chat/components/ChatPanel.tsx')).toBe(true)
    expect(DEFERRED_CHAT_SURFACES.filter((surface) => graph.has(surface))).toEqual([])
  })
})
