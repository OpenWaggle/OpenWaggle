const PRODUCT_LONG_TASK_BUDGET_MS = 50
const HOSTED_CI_LONG_TASK_BUDGET_MS = 125
const LOCAL_SYNTAX_COMPLETION_TIMEOUT_MS = 5_000
const HOSTED_WINDOWS_SYNTAX_COMPLETION_TIMEOUT_MS = 60_000

function isGitHubHostedRunner() {
  return process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted'
}

/**
 * Keep local and self-hosted performance runs strict while bounding the wall-clock descheduling
 * noise observed in hidden Electron processes on GitHub-hosted runners.
 */
export function rendererLongTaskBudget() {
  return isGitHubHostedRunner() ? HOSTED_CI_LONG_TASK_BUDGET_MS : PRODUCT_LONG_TASK_BUDGET_MS
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
