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
  inputs: [
    'src/**',
    'packages/*/src/**',
    'performance/perf-budgets.json',
    'scripts/perf-gate/**',
    'bun.lock',
  ],
  findings: 'generic',
  hint: 'bun run perf:budgets:update, then commit performance/perf-budgets.json (.agents/memory/performance.md)',
}
