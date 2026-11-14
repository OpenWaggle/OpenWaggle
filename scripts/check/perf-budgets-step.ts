/**
 * The `perf-budgets` check step: performance/perf-budgets.json equals what the build and the
 * shipped packages measure (scripts/perf-gate/budgets.ts). It reads `out/`, so it runs after the
 * renderer-bundle build.
 */
import { bunScript } from './step-helpers'
import type { CheckStep } from './step-model'

export const PERF_BUDGETS_STEP: CheckStep = {
  id: 'perf-budgets',
  summary: 'performance/perf-budgets.json equals the build and package measurements',
  commands: [bunScript('scripts/perf-gate/budgets.ts', 'check')],
  dependsOn: ['renderer-bundle'],
  // What the build and the package trim read, besides the sources: a change to any of them can
  // change a measurement.
  inputs: [
    'src/**',
    'packages/*/src/**',
    'performance/perf-budgets.json',
    'scripts/perf-gate/**',
    'scripts/vite/**',
    'scripts/packaged-runtime-packages.ts',
    'scripts/electron-builder-runtime-trim.ts',
    'scripts/main-bundle-graph.ts',
    'scripts/renderer-chunk-graph.ts',
    'package.json',
    'electron-builder.ts',
    'electron.vite.config.ts',
    'bun.lock',
  ],
  findings: 'generic',
  hint: 'bun run perf:budgets:update, then commit performance/perf-budgets.json (.agents/memory/performance.md)',
}
