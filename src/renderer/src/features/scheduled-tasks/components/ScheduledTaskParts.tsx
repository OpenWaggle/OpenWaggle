import type { ScheduledTask, ScheduledTaskRun } from '@shared/types/scheduled-task'
import { AlertTriangle, CalendarClock, HeartPulse } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { describeSchedule } from '../lib/schedule-presets'
import {
  differingTimeZone,
  formatAbsoluteTime,
  nextRunText,
  RUN_STATUS_LABELS,
  runReasonText,
} from '../lib/task-format'

export function ScheduledTaskKindIcon({ task }: { readonly task: Pick<ScheduledTask, 'kind'> }) {
  const Icon = task.kind === 'heartbeat' ? HeartPulse : CalendarClock
  return <Icon aria-hidden="true" className="size-4 shrink-0 text-text-tertiary" />
}

/** "Every 30 minutes · Europe/Paris · Next in 12 minutes (Jan 3, 09:00)". */
export function ScheduledTaskScheduleLine({
  task,
  now,
}: {
  readonly task: ScheduledTask
  readonly now: number
}) {
  const zone = differingTimeZone(task)
  const nextAt = task.enabled && task.waitingSince === null ? task.nextRunAt : null
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-text-tertiary">
      <span>{describeSchedule(task.schedule)}</span>
      {zone ? <span>· {zone}</span> : null}
      <span>·</span>
      <span className={cn(!task.enabled && 'text-text-muted')}>{nextRunText(task, now)}</span>
      {nextAt === null ? null : (
        <span className="text-text-muted">({formatAbsoluteTime(nextAt, zone)})</span>
      )}
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

export function ScheduledTaskLastRunLine({ task }: { readonly task: ScheduledTask }) {
  const run = task.lastRun
  if (!run) return <div className="text-xs text-text-muted">No runs yet</div>
  const reason = runReasonText(run)
  return (
    <div className="text-xs text-text-tertiary">
      Last run <ScheduledTaskRunStatus run={run} /> {formatAbsoluteTime(run.firedAt)}
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
