import {
  isTaskScheduleJittered,
  SCHEDULED_TASK_JITTER_MINUTES,
} from '@shared/domain/scheduled-tasks/task-schedule'
import type {
  HeartbeatRunOutcome,
  ScheduledTask,
  ScheduledTaskKind,
  ScheduledTaskNotificationPolicy,
  ScheduledTaskRun,
  ScheduledTaskRunReason,
  ScheduledTaskRunStatus,
  ScheduledTaskRunTrigger,
  ScheduledTaskRunWakeCheck,
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
  'wake-check-idle': 'Nothing to do',
  'wake-check-failed': 'The wake check failed',
  'wake-check-unapproved': 'Waiting for you to approve its wake check',
}

export const RUN_OUTCOME_LABELS: Readonly<Record<HeartbeatRunOutcome, string>> = {
  acted: 'Acted',
  idle: 'Idle',
  done: 'Done',
}

/** "Idle (reported: nothing changed)", "Acted (inferred)". */
export function runOutcomeText(run: Pick<ScheduledTaskRun, 'outcome'>) {
  const outcome = run.outcome
  if (!outcome) return null
  const label = RUN_OUTCOME_LABELS[outcome.value]
  if (outcome.source === 'inferred') return `${label} (inferred from the tools it used)`
  return outcome.note ? `${label}: ${outcome.note}` : label
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

// Seconds show a jittered time exactly, and the UTC offset tells the two occurrences of an hour
// repeated when clocks go back apart, on the machine's clock as on a task's own. `dateStyle` and
// `timeStyle` cannot be combined with `timeZoneName`, so the fields are spelled out.
const ABSOLUTE_TIME: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  timeZoneName: 'shortOffset',
}
const absoluteFormatters = new Map<string, Intl.DateTimeFormat>()

/** "Oct 26, 2026, 9:58:59 AM GMT+1"; in `timeZone` when the task keeps a different one. */
export function formatAbsoluteTime(at: number, timeZone?: string | null) {
  const key = timeZone ?? ''
  let formatter = absoluteFormatters.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(
      undefined,
      timeZone ? { ...ABSOLUTE_TIME, timeZone } : ABSOLUTE_TIME,
    )
    absoluteFormatters.set(key, formatter)
  }
  return formatter.format(at)
}

/** Hourly-or-slower tasks fire within ±5 minutes of their time (ADR 0057). */
export const NEXT_RUN_JITTER_TEXT = `± up to ${String(SCHEDULED_TASK_JITTER_MINUTES)} min`

/**
 * The next run's absolute time on the task's clock (named when it is not the machine's), saying
 * when it may be up to 5 minutes off; null if none.
 */
export function nextRunAbsoluteText(task: ScheduledTask) {
  if (task.nextRunAt === null) return null
  const at = formatAbsoluteTime(task.nextRunAt, differingTimeZone(task))
  return isTaskScheduleJittered(task) ? `${at} ${NEXT_RUN_JITTER_TEXT}` : at
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

export const WAKE_CHECK_APPROVAL_TEXT = 'Waiting for you to approve its wake check'

/** Whether a Heartbeat is held until the user approves its Wake check. */
export function wakeCheckPending(task: ScheduledTask) {
  return task.heartbeat?.wakeCheck?.approval === 'pending'
}

/** A Heartbeat created before stop conditions, or one set to run forever: it has no end. */
export function heartbeatHasNoEnd(task: ScheduledTask) {
  const heartbeat = task.heartbeat
  if (!heartbeat) return false
  return (
    heartbeat.indefinite &&
    heartbeat.stopWhen === null &&
    task.endsAt === null &&
    task.maxRuns === null
  )
}

const WAKE_CHECK_RESULT_TEXT: Readonly<Record<ScheduledTaskRunWakeCheck, string>> = {
  idle: 'nothing to do',
  woke: 'woke the Run',
  failed: 'check failed',
}

/**
 * "Last check 07:04 · nothing to do · next 07:34" for a gated Heartbeat whose last firing the
 * Wake check decided; null otherwise.
 */
export function lastCheckText(task: ScheduledTask, now: number) {
  const run = task.lastRun
  if (!task.heartbeat?.wakeCheck || !run?.wakeCheck) return null
  const zone = differingTimeZone(task)
  const result = WAKE_CHECK_RESULT_TEXT[run.wakeCheck]
  const next =
    task.enabled && task.nextRunAt !== null
      ? ` · next ${formatPreviewTime(task.nextRunAt, now, zone)}`
      : ''
  return `Last check ${formatPreviewTime(run.firedAt, now, zone)} · ${result}${next}`
}

/** A Heartbeat's state in a word or two, for the Session Summary; null when it just runs. */
export function heartbeatSummaryText(task: ScheduledTask) {
  const heartbeat = task.heartbeat
  if (!heartbeat) return null
  if (heartbeat.autoPause && !task.enabled) return 'Auto-paused'
  if (wakeCheckPending(task)) return 'Approve wake check'
  if (task.enabled && task.lastRun?.wakeCheck === 'idle') return 'Nothing to do'
  return null
}

/** What the row says about the next firing. */
export function nextRunText(task: ScheduledTask, now: number) {
  if (task.heartbeat?.autoPause && !task.enabled) return task.heartbeat.autoPause.message
  if (!task.enabled) return 'Paused'
  if (wakeCheckPending(task)) return WAKE_CHECK_APPROVAL_TEXT
  if (task.waitingSince !== null) return 'Waiting for the Session to be idle'
  if (task.nextRunAt === null) return 'Schedule ended'
  return `Next ${formatRelativeTime(task.nextRunAt, now)}`
}
