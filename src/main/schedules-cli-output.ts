import { isTaskScheduleJittered } from '@shared/domain/scheduled-tasks/task-schedule'
import type {
  ScheduledTask,
  ScheduledTaskRun,
  ScheduledTasksResponse,
  TaskSchedule,
} from '@shared/types/scheduled-task'
import { writeCliStdout } from './cli-stdout'
import { cliWallClockTime } from './cli-wall-clock-time'

const JSON_INDENT_SPACES = 2
export const SCHEDULES_CLI_OUTPUT_SCHEMA_VERSION = 1 as const
const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
const MINUTES_PER_HOUR = 60
const WORKDAY_COUNT = 5

export function describeTaskSchedule(schedule: TaskSchedule) {
  if (schedule.kind === 'interval') {
    const minutes = schedule.everyMinutes
    return minutes % MINUTES_PER_HOUR === 0
      ? `every ${String(minutes / MINUTES_PER_HOUR)}h`
      : `every ${String(minutes)}m`
  }
  if (schedule.kind === 'daily') {
    const days = schedule.weekdays
    if (!days || days.length === WEEKDAY_NAMES.length) return `daily at ${schedule.at}`
    const weekdaysOnly = days.length === WORKDAY_COUNT && days.every((day) => day <= WORKDAY_COUNT)
    if (weekdaysOnly) return `weekdays at ${schedule.at}`
    return `${days.map((day) => WEEKDAY_NAMES[day - 1]).join(', ')} at ${schedule.at}`
  }
  return `rule ${schedule.rule}`
}

function time(value: number | null, timeZone?: string) {
  return value === null ? '-' : cliWallClockTime(value, timeZone)
}

function taskTarget(task: ScheduledTask) {
  return task.target.kind === 'heartbeat'
    ? `Heartbeat into ${task.target.sessionId}`
    : `Launch schedule in ${task.target.projectPath} (${task.target.workspace})`
}

/** Hourly-or-slower tasks fire within ±5 minutes of their time (ADR 0057). */
function nextRun(task: ScheduledTask) {
  const jitter = task.nextRunAt !== null && isTaskScheduleJittered(task) ? ' (±5 min)' : ''
  return `next ${time(task.nextRunAt, task.timeZone)}${jitter}`
}

/** When a run fired and why: `schedule`, `catch-up`, or `run-now`, which fires at no set time. */
function runFiring(run: ScheduledTaskRun, timeZone: string | undefined) {
  return `${time(run.firedAt, timeZone)} ${run.trigger} ${run.status}`
}

function taskLine(task: ScheduledTask, options: { readonly lastRun: boolean }) {
  const state = task.attention ? 'needs attention' : task.enabled ? 'on' : 'paused'
  const waiting = task.waitingSince !== null ? ' · waiting for its Session' : ''
  const last =
    options.lastRun && task.lastRun ? `  last ${runFiring(task.lastRun, task.timeZone)}` : ''
  return `${task.id}  ${task.name}  [${state}]  ${describeTaskSchedule(task.schedule)} (${task.timeZone})  ${nextRun(task)}${waiting}${last}`
}

function lastRunLine(task: ScheduledTask) {
  const run = task.lastRun
  if (!run) return '  Last run: none'
  const session = run.sessionId ? ` → ${run.sessionId}` : ''
  return `  Last run: ${runFiring(run, task.timeZone)}${session}`
}

function taskDetails(task: ScheduledTask) {
  return [
    taskLine(task, { lastRun: false }),
    `  ${taskTarget(task)}`,
    `  Created by ${task.creator.label}; ${String(task.runCount)} run(s); notifies ${task.notificationPolicy}`,
    lastRunLine(task),
    ...(task.attention ? [`  Attention: ${task.attention.message}`] : []),
    `  Prompt: ${task.prompt.split('\n')[0] ?? ''}`,
  ].join('\n')
}

function runLine(run: ScheduledTaskRun, timeZone?: string) {
  const detail = run.reason ? ` (${run.reason}${run.message ? `: ${run.message}` : ''})` : ''
  const session = run.sessionId ? ` → ${run.sessionId}` : ''
  const missed = run.missedCount > 0 ? ` +${String(run.missedCount)} missed` : ''
  return `${time(run.firedAt, timeZone)}  ${run.trigger}${missed}  ${run.status}${detail}${session}`
}

/** The human-readable text of one `openwaggle schedules` response. */
export function formatSchedulesCliResponse(response: ScheduledTasksResponse) {
  const outcome = response.outcome
  if (outcome.effect === 'listed') {
    return outcome.tasks.length === 0
      ? 'No Scheduled tasks.'
      : outcome.tasks.map((task) => taskLine(task, { lastRun: true })).join('\n')
  }
  if (outcome.effect === 'read') {
    const runs =
      outcome.runs.length === 0
        ? ['  No runs yet.']
        : outcome.runs.map((run) => `  ${runLine(run, outcome.task.timeZone)}`)
    return [taskDetails(outcome.task), 'Runs:', ...runs].join('\n')
  }
  if (outcome.effect === 'runs-listed') {
    return outcome.runs.length === 0
      ? 'No runs.'
      : outcome.runs.map((run) => runLine(run)).join('\n')
  }
  if (outcome.effect === 'created') return `Created ${taskDetails(outcome.task)}`
  if (outcome.effect === 'updated') return `Updated ${taskDetails(outcome.task)}`
  if (outcome.effect === 'deleted') return `Deleted ${outcome.taskId}`
  if (outcome.effect === 'run-requested') return `Running ${outcome.task.name} now.`
  return `Refused (${outcome.code}): ${outcome.message}`
}

/** The tasks as input another `openwaggle schedules import` can create again. */
export function exportedTasks(response: ScheduledTasksResponse) {
  if (response.outcome.effect !== 'listed') return []
  return response.outcome.tasks.map((task) => ({
    name: task.name,
    prompt: task.prompt,
    enabled: task.enabled,
    schedule: task.schedule,
    timeZone: task.timeZone,
    endsAt: task.endsAt,
    maxRuns: task.maxRuns,
    target: task.target,
    notificationPolicy: task.notificationPolicy,
  }))
}

export function writeSchedulesCliResponses(
  command: string,
  responses: readonly ScheduledTasksResponse[],
  json: boolean,
) {
  if (command === 'export') {
    const exported = responses.flatMap(exportedTasks)
    return writeCliStdout(`${JSON.stringify(exported, null, JSON_INDENT_SPACES)}\n`)
  }
  const output = json
    ? JSON.stringify(
        {
          schemaVersion: SCHEDULES_CLI_OUTPUT_SCHEMA_VERSION,
          type: 'response',
          command,
          result: responses.length === 1 ? responses[0] : responses,
        },
        null,
        JSON_INDENT_SPACES,
      )
    : responses.map(formatSchedulesCliResponse).join('\n')
  return writeCliStdout(`${output}\n`)
}
