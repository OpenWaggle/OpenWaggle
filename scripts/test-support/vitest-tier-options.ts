import { createRequire } from 'node:module'
import path from 'node:path'
import { EnvironmentGroupedSequencer } from './environment-grouped-sequencer'

/**
 * Options the Vitest tier configs share, so `vitest.coverage.config.ts`, which runs the same tests
 * under instrumentation, takes them from the tiers instead of a copy that drifts. It had none of
 * the Node tiers' deadlines, so 26 tests in 10 files hit Vitest's 5 s default on a clean main.
 */

/** Removes the run's temporary root, under which `isolate-user-home.ts` gives each file its own. */
export const TEST_TEMPORARY_ROOT_SETUP = 'scripts/test-support/vitest-temporary-root.ts'

/**
 * The unit and component tiers keep each worker for many files instead of starting one per file,
 * which made loading the externals again ~60% of the unit tier and jsdom ~50% of the component tier.
 * `REUSED_WORKER_SETUP` must be the first setup file: it gives every file the modules, mocks,
 * globals and patched builtins of a fresh worker (see that file for what it cannot reset).
 */
export const REUSED_WORKERS = {
  isolate: false,
  sequence: { sequencer: EnvironmentGroupedSequencer },
} as const

export const REUSED_WORKER_SETUP = 'scripts/test-support/reused-worker-isolation.ts'

const NODE_TIER_TIMEOUT_MS = 60_000

/*
 * The unit and integration tiers' deadlines. Vitest's 5s default is unrealistic for this suite,
 * not generous. The unit suite spans 365 files whose cumulative import cost is ~576s across
 * workers, so a test that itself does several dynamic imports (the renderer/extension protocol
 * tests each load three modules) can exceed 5s purely waiting on module resolution under parallel
 * load. That produced two timeouts and a non-zero exit while every assertion passed -- verified as
 * contention, not a hang: the same tests pass in isolation and the whole suite is green at a
 * larger deadline.
 *
 * Raised again to 60s for the same reason, this time driven by the commit-policy script tests,
 * which shell out to real `git` repeatedly (~7s each in isolation) and timed out at 15s only when
 * scheduled alongside their sibling file. Real-Git integration tests likewise shell out to `git`
 * many times (worktree add, commit, prune), and a single test can take ~12s on a busy machine
 * while passing in isolation; hooks also run git in setup/teardown. A timeout is a ceiling, not a
 * wait: healthy tests still finish in seconds, so a generous ceiling removes contention flake at
 * no runtime cost.
 */
export const NODE_TIER_TIMEOUTS = {
  testTimeout: NODE_TIER_TIMEOUT_MS,
  hookTimeout: NODE_TIER_TIMEOUT_MS,
} as const

/** The component tier keeps Vitest's default deadlines. */
export const COMPONENT_TIER_TIMEOUTS = {} as const

/**
 * The zone every test runs in. Tests that read local dates passed on UTC CI and failed on a
 * machine far from UTC: one usage-cost test failed at UTC+14 on main. Pinning one zone far from UTC
 * makes every run, on every machine and in the required CI jobs, see local and UTC days disagree
 * for most of the day. UTC+14 (no DST) is as far east as zones go; the nightly workflow runs the
 * unit tier again at `America/Adak` (UTC-10, with DST) through `OPENWAGGLE_TEST_TIME_ZONE`, for
 * mistakes only a zone west of UTC shows. A test that needs another zone stubs `TZ` itself.
 */
export const DEFAULT_TEST_TIME_ZONE = 'Pacific/Kiritimati'

// Env reads here destructure rather than decode: Vitest loads this file with its config, before
// the `@shared` alias exists.
export function testTimeZone({ OPENWAGGLE_TEST_TIME_ZONE: zone }: NodeJS.ProcessEnv = process.env) {
  return zone || DEFAULT_TEST_TIME_ZONE
}

/** The `test.env` entry that pins it; the machine's own `TZ` does not reach the tests. */
export const TEST_TIME_ZONE_ENV = { TZ: testTimeZone() } as const

/**
 * The test tiers' reporters: the compact reporter (one line when green, `file:line:col` per
 * failure), plus GitHub annotations in Actions. `--reporter=default` restores Vitest's own output.
 */
const { GITHUB_ACTIONS: githubActions } = process.env
export const TEST_REPORTERS = [
  './scripts/test-support/vitest-compact-reporter.ts',
  ...(githubActions === 'true' ? ['github-actions'] : []),
]

/*
 * The tiers run on the Bun runtime (`bun --bun vitest`, ADR 0064). The tier configs absorb three
 * Bun differences that would otherwise break tests rather than the code they test:
 *
 * - Bun reports `'__esModule' in namespace` as true for every ES module namespace. Vitest's
 *   interop for an external module then treats a package whose default export is a namespace
 *   (zod's `export { z, z as default }`) as transpiled CommonJS and returns that namespace in
 *   place of the module, so `import { z } from 'zod'` is undefined. Inlining zod sends it through
 *   Vite's own transform, which has no such interop.
 * - Bun resolves a bare `undici` to a partial builtin without `MockAgent` or
 *   `Dispatcher1Wrapper`. The alias loads the npm package the app depends on.
 * - Bun's `os.homedir()` ignores a HOME set after start; `node-os.ts` reads it at call time.
 */
// Through `package.json`: Bun's `require.resolve('undici')` answers with the builtin's name.
const UNDICI_PACKAGE_ENTRY = path.join(
  path.dirname(createRequire(import.meta.url).resolve('undici/package.json')),
  'index.js',
)

const NODE_OS_MODULE = path.join(import.meta.dirname, 'node-os.ts')

export const BUN_RUNTIME_ALIASES = {
  undici: UNDICI_PACKAGE_ENTRY,
  'node:os': NODE_OS_MODULE,
  os: NODE_OS_MODULE,
} as const

export const BUN_RUNTIME_SERVER = { deps: { inline: ['zod'] } }
