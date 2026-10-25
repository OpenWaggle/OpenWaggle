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
