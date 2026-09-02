const PRODUCT_LONG_TASK_BUDGET_MS = 50
const HOSTED_CI_LONG_TASK_BUDGET_MS = 125

/**
 * Keep local and self-hosted performance runs strict while bounding the wall-clock descheduling
 * noise observed in hidden Electron processes on GitHub-hosted runners.
 */
export function rendererLongTaskBudget() {
  const isGitHubHostedRunner =
    process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted'
  return isGitHubHostedRunner ? HOSTED_CI_LONG_TASK_BUDGET_MS : PRODUCT_LONG_TASK_BUDGET_MS
}
