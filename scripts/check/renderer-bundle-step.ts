/**
 * The `renderer-bundle` check step: builds with electron-vite, then checks the renderer chunk
 * shape, the main bundle's shape and the built page's CSP. It holds no size limits; the
 * `perf-budgets` step measures this build against performance/perf-budgets.json.
 */
import { PERF_BUILD_ENV } from '../perf-gate/build-metrics'
import { bunScript, packageBin } from './step-helpers'
import type { CheckStep } from './step-model'

export const RENDERER_BUNDLE_STEP: CheckStep = {
  id: 'renderer-bundle',
  summary: 'electron-vite build, then the renderer chunk shape, main-bundle shape and CSP checks',
  commands: [
    [...packageBin('electron-vite', 'electron-vite'), 'build', '--logLevel', 'warn'],
    bunScript('scripts/check-syntax-bundle.ts'),
    bunScript('scripts/check-main-bundle.ts'),
    bunScript('scripts/check-renderer-csp.ts'),
  ],
  // The build the perf-budgets step measures: one dev slug, so its sizes match on every checkout.
  env: PERF_BUILD_ENV,
  // The runner reads `inputs` only for a step with `cache` (its fingerprint) or `changedFiles`;
  // this step has neither and always runs. They list what the step reads, so adding `cache`
  // later does not skip it after a change that alters the result (__tests__/bundle-step-inputs).
  inputs: [
    'src/**',
    'packages/*/src/**',
    'electron.vite.config.ts',
    'scripts/vite/**',
    'scripts/build-identity.ts',
    'scripts/check-syntax-bundle.ts',
    'scripts/check-main-bundle.ts',
    'scripts/check-renderer-csp.ts',
    'scripts/renderer-inline-scripts.ts',
    'scripts/renderer-chunk-graph.ts',
    'scripts/main-bundle-*.ts',
    'scripts/support/**',
    'package.json',
    'bun.lock',
    'patches/**',
    'tsconfig*.json',
  ],
  findings: 'generic',
  hint: 'bun run check:renderer-bundle',
}
