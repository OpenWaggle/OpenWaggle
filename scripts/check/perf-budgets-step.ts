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
  // The runner reads `inputs` only for a step with `cache` (its fingerprint) or `changedFiles`;
  // this step has neither and always runs. They list what the step reads, so adding `cache`
  // later does not skip it after a change that alters the result (__tests__/bundle-step-inputs).
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
    'scripts/build-identity.ts',
    'scripts/support/**',
    'package.json',
    'electron-builder.ts',
    'electron.vite.config.ts',
    'bun.lock',
    'patches/**',
    'tsconfig*.json',
  ],
  findings: 'generic',
  hint: 'run `bun run perf:budgets:update` and commit performance/perf-budgets.json; no constant to edit, no maintainer needed (.agents/memory/performance.md)',
}
