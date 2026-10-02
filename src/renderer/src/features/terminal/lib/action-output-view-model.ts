import { type ActionRun, isActiveActionRun } from '@shared/types/action-runs'

/** Earlier runs kept above "restarted" dividers in one Action output terminal view. */
export const MAX_FOLLOWED_ACTION_RUNS = 8

/**
 * One read-only Terminal tab attached to the Project action runs of one action in one owner's
 * Workspace resource. It never owns a process: closing it closes only the view (ADR 0043).
 */
export interface ActionOutputView {
  readonly ownerKey: string
  readonly projectPath: string
  readonly actionId: string
  /** The action name shown as "<label> · action output". */
  readonly label: string
  /** Followed runs, oldest first. The last is the current run; earlier ones sit above dividers. */
  readonly runIds: readonly string[]
}

export type ActionOutputRunSummary = Pick<ActionRun, 'id' | 'action' | 'startedAt' | 'status'>

/** Stable element id of a view's tab, unique within its owner's drawer. */
export function actionOutputViewTabId(view: Pick<ActionOutputView, 'actionId'>) {
  return `action-output:${view.actionId}`
}

export function actionOutputViewTitle(view: Pick<ActionOutputView, 'label'>) {
  return `${view.label} · action output`
}

export function withFollowedRun(runIds: readonly string[], runId: string): readonly string[] {
  if (runIds.includes(runId)) return runIds
  return [...runIds, runId].slice(-MAX_FOLLOWED_ACTION_RUNS)
}

/**
 * Follows a restart: once the current run is no longer active, the next run of the same action
 * in the same Workspace resource replaces it. A still-active run is never replaced, so a
 * concurrent finite task cannot pull the view onto a different execution.
 */
export function followReplacementRuns(
  view: Pick<ActionOutputView, 'actionId' | 'runIds'>,
  runs: readonly ActionOutputRunSummary[],
): readonly string[] {
  let runIds = view.runIds
  let current = runs.find((run) => run.id === runIds.at(-1))
  while (current !== undefined && !isActiveActionRun(current)) {
    const startedAfter = current.startedAt
    const next = runs
      .filter(
        (run) =>
          run.action.id === view.actionId &&
          run.startedAt > startedAfter &&
          !runIds.includes(run.id),
      )
      .sort((left, right) => left.startedAt - right.startedAt)[0]
    if (next === undefined) break
    runIds = withFollowedRun(runIds, next.id)
    current = next
  }
  return runIds
}

const RUN_OUTCOME_LABELS: Record<ActionRun['status'], string> = {
  starting: 'starting',
  running: 'running',
  stopping: 'stopping',
  completed: 'completed',
  failed: 'failed',
  stopped: 'stopped',
  interrupted: 'interrupted',
}

export function actionRunOutcomeLabel(run: Pick<ActionRun, 'status' | 'exitCode' | 'ready'>) {
  if (run.status === 'running' && run.ready) return 'ready'
  const label = RUN_OUTCOME_LABELS[run.status]
  return run.exitCode === null ? label : `${label} · exit ${String(run.exitCode)}`
}

const DIM = '\x1b[2m'
const RESET_ATTRIBUTES = '\x1b[0m'
// Leave an alternate screen and show normal attributes before writing view-owned lines.
const NORMAL_SCREEN = `\x1b[?1049l${RESET_ATTRIBUTES}`

export function actionOutputOutcomeLine(
  run: Pick<ActionRun, 'status' | 'exitCode' | 'ready' | 'action'>,
) {
  return `${NORMAL_SCREEN}\r\n${DIM}── ${run.action.name} ${actionRunOutcomeLabel(run)} ──${RESET_ATTRIBUTES}\r\n`
}

export const ACTION_OUTPUT_RESTART_DIVIDER = `${NORMAL_SCREEN}\r\n${DIM}──────── restarted ────────${RESET_ATTRIBUTES}\r\n\r\n`
export const ACTION_OUTPUT_TRIMMED_NOTICE = `${DIM}[Earlier output was trimmed.]${RESET_ATTRIBUTES}\r\n`
export const ACTION_OUTPUT_GAP_NOTICE = `\r\n${DIM}[Output gap: older retained output was trimmed.]${RESET_ATTRIBUTES}\r\n`

// ED3 erases xterm's scrollback, which would delete earlier runs above a restart divider.
const ERASE_SCROLLBACK = '\x1b[3J'

/** A read-only view keeps its scrollback; the run's own clear-screen still scrolls it away. */
export function sanitizeActionOutputChunk(text: string) {
  return text.replaceAll(ERASE_SCROLLBACK, '')
}
