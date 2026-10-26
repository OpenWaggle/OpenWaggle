/**
 * Options the Vitest tier configs share, so `vitest.coverage.config.ts`, which runs the same tests
 * under instrumentation, takes them from the tiers instead of a copy that drifts. It had none of
 * the Node tiers' deadlines, so 26 tests in 10 files hit Vitest's 5 s default on a clean main.
 */

/** Removes the run's temporary root, under which `isolate-user-home.ts` gives each file its own. */
export const TEST_TEMPORARY_ROOT_SETUP = 'scripts/test-support/vitest-temporary-root.ts'

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

export function testTimeZone(environment: NodeJS.ProcessEnv = process.env) {
  return environment.OPENWAGGLE_TEST_TIME_ZONE || DEFAULT_TEST_TIME_ZONE
}

/** The `test.env` entry that pins it; the machine's own `TZ` does not reach the tests. */
export const TEST_TIME_ZONE_ENV = { TZ: testTimeZone() } as const
