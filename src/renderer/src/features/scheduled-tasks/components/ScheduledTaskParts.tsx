import type { ScheduledTask, ScheduledTaskRun } from '@shared/types/scheduled-task'
import { AlertTriangle, CalendarClock, HeartPulse } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { describeSchedule } from '../lib/schedule-presets'
import {
  differingTimeZone,
  formatAbsoluteTime,
  nextRunAbsoluteText,
  nextRunText,
  RUN_STATUS_LABELS,
  RUN_TRIGGER_LABELS,
  runReasonText,
} from '../lib/task-format'

export function ScheduledTaskKindIcon({ task }: { readonly task: Pick<ScheduledTask, 'kind'> }) {
  const Icon = task.kind === 'heartbeat' ? HeartPulse : CalendarClock
  return <Icon aria-hidden="true" className="size-4 shrink-0 text-text-tertiary" />
}

/** "Every day at 09:00 · Europe/Paris · Next in 12 minutes (Jan 3, 2026, 8:58:59 AM GMT+1 ± up to 5 min)". */
export function ScheduledTaskScheduleLine({
  task,
  now,
}: {
  readonly task: ScheduledTask
  readonly now: number
}) {
  const zone = differingTimeZone(task)
  const nextAt = task.enabled && task.waitingSince === null ? nextRunAbsoluteText(task) : null
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-text-tertiary">
      <span>{describeSchedule(task.schedule)}</span>
      {zone ? <span>· {zone}</span> : null}
      <span>·</span>
      <span className={cn(!task.enabled && 'text-text-muted')}>{nextRunText(task, now)}</span>
      {nextAt === null ? null : <span className="text-text-muted">({nextAt})</span>}
    </div>
  )
}

const RUN_STATUS_CLASS: Readonly<Record<ScheduledTaskRun['status'], string>> = {
  started: 'text-success',
  skipped: 'text-text-tertiary',
  failed: 'text-error-text',
}

export function ScheduledTaskRunStatus({ run }: { readonly run: ScheduledTaskRun }) {
  return (
    <span className={cn('font-medium', RUN_STATUS_CLASS[run.status])}>
      {RUN_STATUS_LABELS[run.status]}
    </span>
  )
}

/** "Last run Started · Run now · Mar 2, 2026, 9:01:30 AM GMT+1": a manual run is never a misfire. */
export function ScheduledTaskLastRunLine({ task }: { readonly task: ScheduledTask }) {
  const run = task.lastRun
  if (!run) return <div className="text-xs text-text-muted">No runs yet</div>
  const reason = runReasonText(run)
  return (
    <div className="text-xs text-text-tertiary">
      Last run <ScheduledTaskRunStatus run={run} /> · {RUN_TRIGGER_LABELS[run.trigger]} ·{' '}
      {formatAbsoluteTime(run.firedAt, differingTimeZone(task))}
      {reason ? <span className="text-text-secondary"> — {reason}</span> : null}
    </div>
  )
}

export function ScheduledTaskAttention({ task }: { readonly task: ScheduledTask }) {
  if (!task.attention) return null
  return (
    <div
      role="alert"
      className="mt-1.5 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-xs text-text-primary"
    >
      <AlertTriangle aria-hidden="true" className="mt-px size-3.5 shrink-0 text-warning" />
      <span>
        <span className="font-medium">Needs attention:</span> {task.attention.message}
      </span>
    </div>
  )
}
