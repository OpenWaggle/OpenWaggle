import type { ScheduledTask, ScheduledTaskRun } from '@shared/types/scheduled-task'
import { runReasonText } from './task-format'

export interface ScheduledTaskNotice {
  readonly taskId: string
  readonly variant: 'neutral' | 'error'
  readonly message: string
  /** Open the task, or turn an auto-paused Heartbeat back on. */
  readonly action: 'open' | 'resume'
}

/** What the notifier remembers about a task between two list reads. */
export interface ScheduledTaskNoticeSnapshot {
  readonly lastRunId: string | null
  readonly attentionSince: number | null
  readonly autoPauseSince: number | null
}

export function noticeSnapshots(tasks: readonly ScheduledTask[]) {
  const snapshots = new Map<string, ScheduledTaskNoticeSnapshot>()
  for (const task of tasks) {
    snapshots.set(task.id, {
      lastRunId: task.lastRun?.id ?? null,
      attentionSince: task.attention?.since ?? null,
      autoPauseSince: task.heartbeat?.autoPause?.since ?? null,
    })
  }
  return snapshots
}

/** A skip for an authority reason always notifies (CONTEXT.md: Scheduled tasks). */
function isAuthoritySkip(run: ScheduledTaskRun) {
  return run.status === 'skipped' && run.reason === 'creator-authority-revoked'
}

function runNotice(task: ScheduledTask, run: ScheduledTaskRun): ScheduledTaskNotice | null {
  const reason = runReasonText(run)
  if (run.status === 'failed' || isAuthoritySkip(run)) {
    const verb = run.status === 'failed' ? 'failed' : 'was skipped'
    return {
      taskId: task.id,
      variant: 'error',
      message: `Scheduled task “${task.name}” ${verb}${reason ? `: ${reason}` : '.'}`,
      action: 'open',
    }
  }
  if (run.status === 'started' && task.notificationPolicy === 'every-run') {
    const what = task.kind === 'launch' ? 'started a Session' : 'delivered its prompt'
    return {
      taskId: task.id,
      variant: 'neutral',
      message: `Scheduled task “${task.name}” ${what}.`,
      action: 'open',
    }
  }
  return null
}

function taskNotices(task: ScheduledTask, previous: ScheduledTaskNoticeSnapshot | undefined) {
  const notices: ScheduledTaskNotice[] = []
  const run = task.lastRun
  // A task first seen now announces nothing about runs that happened before it was known.
  if (previous && run && run.id !== previous.lastRunId) {
    const notice = runNotice(task, run)
    if (notice) notices.push(notice)
  }
  const attention = task.attention
  if (attention && attention.since !== (previous?.attentionSince ?? null)) {
    notices.push({
      taskId: task.id,
      variant: 'error',
      message: `Scheduled task “${task.name}” needs attention: ${attention.message}`,
      action: 'open',
    })
  }
  const autoPause = task.heartbeat?.autoPause
  // One notice per Auto-pause, with Resume; a task first seen paused announces nothing.
  if (previous && autoPause && !task.enabled && autoPause.since !== previous.autoPauseSince) {
    notices.push({
      taskId: task.id,
      variant: 'neutral',
      message: `Heartbeat “${task.name}” ${autoPause.message}.`,
      action: 'resume',
    })
  }
  return notices
}

/**
 * The toasts one list refresh produces, compared with the previous read. The first read is a
 * baseline: it announces nothing, so opening the app does not replay old runs.
 */
export function scheduledTaskNotices(
  previous: ReadonlyMap<string, ScheduledTaskNoticeSnapshot> | null,
  tasks: readonly ScheduledTask[],
): readonly ScheduledTaskNotice[] {
  if (previous === null) return []
  return tasks.flatMap((task) => taskNotices(task, previous.get(task.id)))
}
