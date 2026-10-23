import type {
  ScheduledTask,
  ScheduledTaskKind,
  ScheduledTaskNotificationPolicy,
  ScheduledTaskRun,
  ScheduledTaskRunReason,
  ScheduledTaskRunStatus,
  ScheduledTaskRunTrigger,
} from '@shared/types/scheduled-task'
import { machineTimeZone } from '@shared/utils/zoned-time'

export const SCHEDULED_TASK_KIND_LABELS: Readonly<Record<ScheduledTaskKind, string>> = {
  heartbeat: 'Heartbeat',
  launch: 'Launch schedule',
}

export const RUN_STATUS_LABELS: Readonly<Record<ScheduledTaskRunStatus, string>> = {
  started: 'Started',
  skipped: 'Skipped',
  failed: 'Failed',
}

export const RUN_TRIGGER_LABELS: Readonly<Record<ScheduledTaskRunTrigger, string>> = {
  schedule: 'Scheduled',
  'catch-up': 'Catch-up',
  'run-now': 'Run now',
}

export const NOTIFICATION_POLICY_LABELS: Readonly<Record<ScheduledTaskNotificationPolicy, string>> =
  {
    'failures-only': 'Only failures and attention',
    'every-run': 'Every run',
  }

const RUN_REASON_LABELS: Readonly<Record<ScheduledTaskRunReason, string>> = {
  'session-busy': 'The Session was busy until the next fire time',
  'previous-run-active': 'The previous run was still active',
  'host-capacity-reached': 'The Session Host was at its active-run limit',
  'pi-cli-wrote-last': 'The pi CLI wrote to this Session last',
  'creator-authority-revoked': 'The task’s creator no longer has access',
  'target-session-archived': 'The target Session is archived',
  'target-session-missing': 'The target Session no longer exists',
  'project-missing': 'The project no longer exists',
  'model-unavailable': 'The model is unavailable',
  'agent-definition-invalid': 'The Agent definition is invalid',
  'launch-refused': 'The Session launch was refused',
  'dispatch-failed': 'Delivery failed',
  'interrupted-by-host-stop': 'The Session Host stopped during the run',
}

export function defaultNotificationPolicy(
  kind: ScheduledTaskKind,
): ScheduledTaskNotificationPolicy {
  return kind === 'heartbeat' ? 'failures-only' : 'every-run'
}

/** Why a run was skipped or failed, with the Host's message when it adds something. */
export function runReasonText(run: Pick<ScheduledTaskRun, 'reason' | 'message'>) {
  const reason = run.reason ? RUN_REASON_LABELS[run.reason] : null
  const message = run.message?.trim() || null
  if (reason && message) return `${reason}: ${message}`
  return reason ?? message
}

/** "Started", or "Failed — The model is unavailable". */
export function runSummaryText(run: ScheduledTaskRun) {
  const reason = runReasonText(run)
  const status = RUN_STATUS_LABELS[run.status]
  return reason ? `${status} — ${reason}` : status
}

export { machineTimeZone }

/** The task's zone, shown only when it is not the machine's own (a stored zone never moves). */
export function differingTimeZone(task: Pick<ScheduledTask, 'timeZone'>) {
  return task.timeZone === machineTimeZone() ? null : task.timeZone
}

const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24
const RELATIVE_NOW_SECONDS = 45

const relativeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

/** "in 12 minutes", "3 hours ago", "now". */
export function formatRelativeTime(at: number, now: number) {
  const seconds = Math.round((at - now) / MS_PER_SECOND)
  if (Math.abs(seconds) < RELATIVE_NOW_SECONDS) return 'now'
  const minutes = Math.round(seconds / SECONDS_PER_MINUTE)
  if (Math.abs(minutes) < MINUTES_PER_HOUR) return relativeFormatter.format(minutes, 'minute')
  const hours = Math.round(minutes / MINUTES_PER_HOUR)
  if (Math.abs(hours) < HOURS_PER_DAY) return relativeFormatter.format(hours, 'hour')
  return relativeFormatter.format(Math.round(hours / HOURS_PER_DAY), 'day')
}

const ABSOLUTE_TIME: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }
// `dateStyle` and `timeStyle` cannot be combined with `timeZoneName`, so a zoned time spells
// out its fields instead.
const ZONED_ABSOLUTE_TIME: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
}
const absoluteFormatters = new Map<string, Intl.DateTimeFormat>()

/** Absolute local date and time; in `timeZone` when the task keeps a different one. */
export function formatAbsoluteTime(at: number, timeZone?: string | null) {
  const key = timeZone ?? ''
  let formatter = absoluteFormatters.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(
      undefined,
      timeZone ? { ...ZONED_ABSOLUTE_TIME, timeZone } : ABSOLUTE_TIME,
    )
    absoluteFormatters.set(key, formatter)
  }
  return formatter.format(at)
}

const PREVIEW_TIME: Intl.DateTimeFormatOptions = { timeStyle: 'short' }
const PREVIEW_DATE_TIME: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
}

const PREVIEW_DAY: Intl.DateTimeFormatOptions = { dateStyle: 'short' }
const previewFormatters = new Map<string, Intl.DateTimeFormat>()

/** One formatter per shape and zone: the preview formats three times on every keystroke. */
function previewFormatter(
  shape: 'day' | 'time' | 'date-time',
  timeZone: string | null | undefined,
): Intl.DateTimeFormat {
  const key = `${shape}:${timeZone ?? ''}`
  const cached = previewFormatters.get(key)
  if (cached) return cached
  const options = { day: PREVIEW_DAY, time: PREVIEW_TIME, 'date-time': PREVIEW_DATE_TIME }[shape]
  const formatter = new Intl.DateTimeFormat(shape === 'day' ? 'en-CA' : undefined, {
    ...options,
    ...(timeZone ? { timeZone } : {}),
  })
  previewFormatters.set(key, formatter)
  return formatter
}

/** A compact next-run time: "20:45" today, "Fri 23 Oct, 09:00" on another day. */
export function formatPreviewTime(at: number, now: number, timeZone?: string | null) {
  const day = previewFormatter('day', timeZone)
  const sameDay = day.format(at) === day.format(now)
  return previewFormatter(sameDay ? 'time' : 'date-time', timeZone).format(at)
}

/** What the row says about the next firing. */
export function nextRunText(task: ScheduledTask, now: number) {
  if (!task.enabled) return 'Paused'
  if (task.waitingSince !== null) return 'Waiting for the Session to be idle'
  if (task.nextRunAt === null) return 'Schedule ended'
  return `Next ${formatRelativeTime(task.nextRunAt, now)}`
}
