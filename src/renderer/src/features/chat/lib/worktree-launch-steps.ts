import type { WorktreeLaunchSnapshot } from '@shared/types/background-run'

export type LaunchStepState = 'pending' | 'active' | 'complete' | 'failed'

export interface LaunchStepView {
  readonly key: string
  readonly label: string
  readonly state: LaunchStepState
}

const FINAL_STEP_LABEL = 'Starting task'

export function isLocalLaunch(launch: WorktreeLaunchSnapshot) {
  return launch.environment === 'local'
}

function openStepState(launch: WorktreeLaunchSnapshot): LaunchStepState {
  if (launch.status === 'complete') return 'complete'
  return launch.status === 'failed' ? 'failed' : 'active'
}

/**
 * The visible steps of a launch, Codex-style: every step the Host reported in start order, then
 * "Starting task". A step without `completedAt` is still running, so the local branch sync and the
 * MCP connections can both spin at once. "Starting task" becomes current once no step is open.
 *
 * Returns null for a snapshot without labelled steps (an older Host, or recovery state persisted
 * by an older renderer); the caller keeps the original two-stage presentation for those.
 */
export function launchStepViews(launch: WorktreeLaunchSnapshot): readonly LaunchStepView[] | null {
  const steps = launch.steps ?? []
  if (steps.length === 0) return null
  const views: LaunchStepView[] = steps.map((step) => ({
    key: `${step.stage}:${String(step.startedAt)}`,
    label: step.label,
    state: step.completedAt === undefined ? openStepState(launch) : 'complete',
  }))
  const anyOpen = steps.some((step) => step.completedAt === undefined)
  const finalState: LaunchStepState =
    launch.status === 'complete' ? 'complete' : anyOpen ? 'pending' : openStepState(launch)
  return [...views, { key: 'starting-task', label: FINAL_STEP_LABEL, state: finalState }]
}

/** The sentence a screen reader hears for the step in progress, or for the failure. */
export function launchStepAnnouncement(
  steps: readonly LaunchStepView[],
  failureLabel: string,
  displayErrorMessage: string,
) {
  const failed = steps.find((step) => step.state === 'failed')
  if (failed) return `${failureLabel}${displayErrorMessage ? `: ${displayErrorMessage}` : ''}`
  // Parallel steps run together, so every one in progress is announced, not just the first.
  const active = steps.filter((step) => step.state === 'active').map((step) => step.label)
  return active.length > 0 ? active.join(', ') : FINAL_STEP_LABEL
}
