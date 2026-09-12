const PRODUCT_LONG_TASK_BUDGET_MS = 50
const HOSTED_CI_LONG_TASK_BUDGET_MS = 125
const LOCAL_SYNTAX_COMPLETION_TIMEOUT_MS = 5_000
const HOSTED_WINDOWS_SYNTAX_COMPLETION_TIMEOUT_MS = 60_000

interface PerformanceBudgetRuntime {
  readonly githubActions: string | undefined
  readonly platform: NodeJS.Platform
  readonly runnerEnvironment: string | undefined
}

function currentRuntime(): PerformanceBudgetRuntime {
  return {
    githubActions: process.env.GITHUB_ACTIONS,
    platform: process.platform,
    runnerEnvironment: process.env.RUNNER_ENVIRONMENT,
  }
}

function isGitHubHostedRunner(runtime = currentRuntime()) {
  return runtime.githubActions === 'true' && runtime.runnerEnvironment === 'github-hosted'
}

/**
 * Keep local and self-hosted performance runs strict while bounding the wall-clock descheduling
 * noise observed in hidden Electron processes on GitHub-hosted runners.
 */
export function rendererLongTaskBudget() {
  return isGitHubHostedRunner() ? HOSTED_CI_LONG_TASK_BUDGET_MS : PRODUCT_LONG_TASK_BUDGET_MS
}

/**
 * Chromium long-task durations are wall-clock measurements. During this test's roughly 40-second
 * hidden-renderer window, a shared hosted Windows VM can deschedule Electron for several seconds
 * and report that pause as one renderer task. The scenario still enforces deterministic first
 * paint, bounded DOM/worker/transfer work, eventual syntax completion, and renderer-error checks;
 * absolute long-task budgets remain enforced everywhere with a calibrated clock.
 */
export function shouldEnforceLargeSourceLongTaskBudget(
  runtime: PerformanceBudgetRuntime = currentRuntime(),
) {
  return !(isGitHubHostedRunner(runtime) && runtime.platform === 'win32')
}

/**
 * Worker completion is not an interaction budget: the source skeleton is already readable while
 * highlighting proceeds. Hidden Windows Electron can be CPU-descheduled for several seconds on a
 * hosted runner, so wait long enough to assert eventual completion without weakening first paint.
 */
export function syntaxCompletionTimeout() {
  return isGitHubHostedRunner() && process.platform === 'win32'
    ? HOSTED_WINDOWS_SYNTAX_COMPLETION_TIMEOUT_MS
    : LOCAL_SYNTAX_COMPLETION_TIMEOUT_MS
}
