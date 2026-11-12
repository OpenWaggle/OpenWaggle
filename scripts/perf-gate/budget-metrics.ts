/**
 * Every metric in `performance/perf-budgets.json`: what it counts, its unit, its quantum (the file
 * stores the measurement rounded up to a multiple of it) and what measures it.
 *
 * - `build`: `scripts/perf-gate/budgets.ts check`, the `perf-budgets` step of `bun run check`,
 *   from `out/` and `node_modules` (build-metrics.ts, package-closure.ts);
 * - a test file: an integration test that runs the workload and compares its values with the
 *   file (`recordPerfMeasurements`).
 *
 * A count that should never move silently (processes, IPC calls, queries, batches) has quantum 1. A
 * size or a count that grows with features has a quantum near 0.5% of its value when it was set,
 * so a small change does not touch the file. A coarser quantum is a raised limit: the Performance
 * Gate needs the perf-budget-increase label for it, as for a raised value.
 */

export type PerfBudgetUnit = 'bytes' | 'count'

export interface PerfBudgetMetric {
  readonly id: string
  readonly title: string
  readonly unit: PerfBudgetUnit
  readonly quantum: number
  /** `build`, or the repository path of the integration test that measures it. */
  readonly source: string
  /** What to look at when the value goes up. */
  readonly fix: string
}

const KIBIBYTE = 1024
const PACKAGE_BYTES_QUANTUM = 256 * KIBIBYTE
const RENDERER_BYTES_QUANTUM = 64 * KIBIBYTE
const PACKAGE_FILES_QUANTUM = 8
const MODULES_QUANTUM = 16
const ASSET_FILES_QUANTUM = 4
const PRELOAD_BYTES_QUANTUM = 256
const EXACT = 1

export const BUILD_SOURCE = 'build'
const HOST_STARTUP_SOURCE = 'scripts/perf-gate/__tests__/host-startup-processes.integration.test.ts'
const POWERSHELL_FIX =
  'Each Windows user-only security call is one powershell.exe (about 0.8 s on hosted Windows); batch the targets into one call (src/main/session-host/local-session-paths.ts).'
const SESSION_DATA_SOURCE = 'scripts/perf-gate/__tests__/session-data-budgets.integration.test.ts'
/** About 0.5% of the sidebar's replies (166 KiB) when it was set. */
const SIDEBAR_BYTES_QUANTUM = KIBIBYTE
/** About 0.5% of a long Session's open replies (1.06 MiB) when it was set. */
const SESSION_OPEN_BYTES_QUANTUM = 5 * KIBIBYTE

export const PERF_BUDGET_METRICS: readonly PerfBudgetMetric[] = [
  {
    id: 'package.runtime.packages',
    title: 'Packages the app ships from node_modules',
    unit: 'count',
    quantum: EXACT,
    source: BUILD_SOURCE,
    fix: 'A new external or one of its dependencies ships; bundle it (BUNDLED_DEPS in scripts/vite/main-externals.ts) or drop it.',
  },
  {
    id: 'package.runtime.files',
    title: 'Files the app ships from node_modules',
    unit: 'count',
    quantum: PACKAGE_FILES_QUANTUM,
    source: BUILD_SOURCE,
    fix: 'Leave files the app never loads out of the pack (PACKAGE_UNLOADED_FILES in scripts/packaged-runtime-packages.ts).',
  },
  {
    id: 'package.runtime.bytes',
    title: 'Bytes the app ships from node_modules',
    unit: 'bytes',
    quantum: PACKAGE_BYTES_QUANTUM,
    source: BUILD_SOURCE,
    fix: 'Leave files the app never loads out of the pack (PACKAGE_UNLOADED_FILES in scripts/packaged-runtime-packages.ts).',
  },
  {
    id: 'main.startup.modules',
    title: 'Source modules the desktop app loads before its window shows',
    unit: 'count',
    quantum: MODULES_QUANTUM,
    source: BUILD_SOURCE,
    fix: 'Load what the window does not need on use (lazyModule, dynamic import) or drop the dependency.',
  },
  {
    id: 'main.startup.package-modules',
    title: 'Package modules the desktop app loads before its window shows',
    unit: 'count',
    quantum: MODULES_QUANTUM,
    source: BUILD_SOURCE,
    fix: 'A dependency pulled in more of itself; import the narrow entry point or load it on use.',
  },
  {
    id: 'main.workers.bytes',
    title: 'Main-process worker scripts',
    unit: 'bytes',
    quantum: KIBIBYTE,
    source: BUILD_SOURCE,
    fix: 'A worker bundle grew; check what its entry imports (electron.vite.config.ts).',
  },
  {
    id: 'preload.bytes',
    title: 'Preload script',
    unit: 'bytes',
    quantum: PRELOAD_BYTES_QUANTUM,
    source: BUILD_SOURCE,
    fix: 'The preload runs before every page; keep it a thin IPC bridge (src/preload).',
  },
  {
    id: 'renderer.assets.files',
    title: 'Renderer asset files',
    unit: 'count',
    quantum: ASSET_FILES_QUANTUM,
    source: BUILD_SOURCE,
    fix: 'New chunks or assets in out/renderer/assets; check what the change imports.',
  },
  {
    id: 'renderer.assets.bytes',
    title: 'Renderer asset bytes',
    unit: 'bytes',
    quantum: RENDERER_BYTES_QUANTUM,
    source: BUILD_SOURCE,
    fix: 'The renderer build grew; check what the change imports and whether it can load on use.',
  },
  {
    id: 'renderer.chat-ready.requests',
    title: 'Renderer requests before the chat is ready',
    unit: 'count',
    quantum: EXACT,
    source: BUILD_SOURCE,
    fix: 'index.html or the chat surface reference more files; defer the new import with lazy() where its surface opens.',
  },
  {
    id: 'renderer.chat-ready.chunks',
    title: 'Renderer chunks before the chat is ready',
    unit: 'count',
    quantum: EXACT,
    source: BUILD_SOURCE,
    fix: 'The launch graph or the chat surface split into more chunks; defer the new import with lazy() where its surface opens.',
  },
  {
    id: 'host.startup.windows-powershell.first-launch',
    title: 'PowerShell runs securing the Host paths, first Windows start',
    unit: 'count',
    quantum: EXACT,
    source: HOST_STARTUP_SOURCE,
    fix: POWERSHELL_FIX,
  },
  {
    id: 'host.startup.windows-powershell.later-launch',
    title: 'PowerShell runs securing the Host paths, later Windows start',
    unit: 'count',
    quantum: EXACT,
    source: HOST_STARTUP_SOURCE,
    fix: POWERSHELL_FIX,
  },
  {
    id: 'sessions.sidebar.bytes',
    title: 'Bytes the Host sends when the sidebar opens on a 3,000-Session project',
    unit: 'bytes',
    quantum: SIDEBAR_BYTES_QUANTUM,
    source: SESSION_DATA_SOURCE,
    fix: 'A Session summary grew or the sidebar reads more of them; keep SessionSummary lean (hydrateSessionNavigationRows in src/main/store/sessions/session-list.ts) and the catalog paged (SESSION_CATALOG_PAGE_SIZE).',
  },
  {
    id: 'sessions.sidebar.rows',
    title: 'SQLite rows read when the sidebar opens on a 3,000-Session project',
    unit: 'count',
    quantum: EXACT,
    source: SESSION_DATA_SOURCE,
    fix: 'A catalog query reads rows beyond the page it returns; bound it by the page ids (src/main/store/sessions/session-catalog.ts, session-list.ts).',
  },
  {
    id: 'sessions.sidebar.queries',
    title: 'SQLite statements run when the sidebar opens on a 3,000-Session project',
    unit: 'count',
    quantum: EXACT,
    source: SESSION_DATA_SOURCE,
    fix: 'A summary field costs a query per page or per Session; load it in the page-wide queries of hydrateSessionNavigationRows (src/main/store/sessions/session-list.ts).',
  },
  {
    id: 'sessions.sidebar.by-ids-batches',
    title: 'listSessionsByIds calls when the sidebar opens on a 3,000-Session project',
    unit: 'count',
    quantum: EXACT,
    source: SESSION_DATA_SOURCE,
    fix: 'The sidebar hydrates more Sessions by id at open; read them from the catalog pages instead, or batch them by SESSION_CATALOG_PAGE_SIZE (features/sessions/state/session-catalog-store-actions.ts).',
  },
  {
    id: 'sessions.open.bytes',
    title: 'Bytes the Host sends when a 2,000-message Session opens',
    unit: 'bytes',
    quantum: SESSION_OPEN_BYTES_QUANTUM,
    source: SESSION_DATA_SOURCE,
    fix: 'The open moves more of the transcript; keep the detail to SESSION_DETAIL_MESSAGE_WINDOW messages and the workspace to its transcript window (src/shared/utils/session-data-view.ts).',
  },
  {
    id: 'sessions.open.rows',
    title: 'SQLite rows read when a 2,000-message Session opens',
    unit: 'count',
    quantum: EXACT,
    source: SESSION_DATA_SOURCE,
    fix: 'Opening a Session reads nodes the window does not show; bound the detail and workspace queries by their window (src/main/store/session-details/session-queries.ts, src/main/store/sessions/session-workspace.ts).',
  },
  {
    id: 'sessions.open.queries',
    title: 'SQLite statements run when a 2,000-message Session opens',
    unit: 'count',
    quantum: EXACT,
    source: SESSION_DATA_SOURCE,
    fix: 'Opening a Session runs a query per message or node; read them in one windowed query (src/main/store/session-details/message-hydration.ts, src/main/store/sessions/node-hydration.ts).',
  },
]
