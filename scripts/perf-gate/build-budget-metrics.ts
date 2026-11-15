/**
 * The metric shape of performance/perf-budgets.json, and the bundle bytes the build measures
 * (build-metrics.ts) that once were ceilings in scripts/check-syntax-bundle.ts, check-main-bundle.ts
 * and main-bundle-graph.ts. Each quantum is about 0.5% of the value when it moved here
 * (November 2026), so a small change does not touch the file.
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

export const BUILD_SOURCE = 'build'

const KIBIBYTE = 1024
/** 24.8 KiB when it moved here. */
const BOOT_BYTES_QUANTUM = 256
/** 15.5 MiB, the one-file main bundle, when it moved here. */
const MAIN_STARTUP_BYTES_QUANTUM = 64 * KIBIBYTE
/** The entry (278 KiB) and the workers (183 to 207 KiB) when they moved here. */
const SCRIPT_BYTES_QUANTUM = KIBIBYTE
/** 1.66 MiB when it moved here. */
const INITIAL_GRAPH_BYTES_QUANTUM = 8 * KIBIBYTE
/** 760 KiB when it moved here. */
const CHAT_SURFACE_BYTES_QUANTUM = 4 * KIBIBYTE

const LAZY_RENDERER_FIX = 'Defer the new code with lazy() where its surface opens.'
const MAIN_STARTUP_FIX =
  'Every process of this kind loads it before its work; load what startup does not need on use (lazyModule, dynamic import) or drop the dependency.'

function bundleBytes(id: string, title: string, quantum: number, fix: string) {
  const metric: PerfBudgetMetric = { id, title, unit: 'bytes', quantum, source: BUILD_SOURCE, fix }
  return metric
}

export const MAIN_BUNDLE_BUDGET_METRICS: readonly PerfBudgetMetric[] = [
  bundleBytes(
    'main.boot.bytes',
    'Boot shim every process compiles from source',
    BOOT_BYTES_QUANTUM,
    'It runs before V8 compile cache exists; keep anything more out of what src/main/boot.ts imports.',
  ),
  bundleBytes(
    'main.startup.gui.bytes',
    'Main bundle the desktop app loads at startup',
    MAIN_STARTUP_BYTES_QUANTUM,
    MAIN_STARTUP_FIX,
  ),
  bundleBytes(
    'main.startup.session-host.bytes',
    'Main bundle the Session Host loads at startup',
    MAIN_STARTUP_BYTES_QUANTUM,
    MAIN_STARTUP_FIX,
  ),
  bundleBytes(
    'main.startup.hive.bytes',
    'Main bundle `openwaggle hive` loads at startup',
    MAIN_STARTUP_BYTES_QUANTUM,
    MAIN_STARTUP_FIX,
  ),
  bundleBytes(
    'main.startup.run.bytes',
    'Main bundle `openwaggle run` loads at startup',
    MAIN_STARTUP_BYTES_QUANTUM,
    MAIN_STARTUP_FIX,
  ),
  bundleBytes(
    'main.startup.mcp.bytes',
    'Main bundle `openwaggle mcp` loads at startup',
    MAIN_STARTUP_BYTES_QUANTUM,
    MAIN_STARTUP_FIX,
  ),
]

export const RENDERER_BUNDLE_BUDGET_METRICS: readonly PerfBudgetMetric[] = [
  bundleBytes(
    'renderer.initial.entry.bytes',
    'Renderer entry script',
    SCRIPT_BYTES_QUANTUM,
    `It measures how Rolldown splits boot between the entry and its preloaded chunks (renderer.md). ${LAZY_RENDERER_FIX}`,
  ),
  bundleBytes(
    'renderer.initial.bytes',
    'Renderer scripts index.html loads at boot (the entry and its preloads)',
    INITIAL_GRAPH_BYTES_QUANTUM,
    LAZY_RENDERER_FIX,
  ),
  bundleBytes(
    'renderer.chat-surface.bytes',
    'Chat surface chunks the welcome and Session routes load before the composer',
    CHAT_SURFACE_BYTES_QUANTUM,
    `The chat surface loads right after the shell renders (renderer-load.md). ${LAZY_RENDERER_FIX}`,
  ),
  bundleBytes(
    'renderer.syntax-worker.bytes',
    'Syntax highlighting worker',
    SCRIPT_BYTES_QUANTUM,
    'Check what the syntax worker bundles; grammars and themes load on use.',
  ),
  bundleBytes(
    'renderer.focused-editor.bytes',
    'Focused source editor chunk',
    SCRIPT_BYTES_QUANTUM,
    'Check what FocusedSourceEditor imports; language support loads on use.',
  ),
  bundleBytes(
    'renderer.focused-editor-worker.bytes',
    'Focused source editor worker',
    SCRIPT_BYTES_QUANTUM,
    'Check what the editor worker bundles.',
  ),
]
