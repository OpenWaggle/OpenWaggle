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

function taskLine(task: ScheduledTask) {
  const state = task.attention ? 'needs attention' : task.enabled ? 'on' : 'paused'
  const waiting = task.waitingSince !== null ? ' · waiting for its Session' : ''
  return `${task.id}  ${task.name}  [${state}]  ${describeTaskSchedule(task.schedule)} (${task.timeZone})  next ${time(task.nextRunAt, task.timeZone)}${waiting}`
}

function taskDetails(task: ScheduledTask) {
  return [
    taskLine(task),
    `  ${taskTarget(task)}`,
    `  Created by ${task.creator.label}; ${String(task.runCount)} run(s); notifies ${task.notificationPolicy}`,
    ...(task.attention ? [`  Attention: ${task.attention.message}`] : []),
    `  Prompt: ${task.prompt.split('\n')[0] ?? ''}`,
  ].join('\n')
}

function runLine(run: ScheduledTaskRun) {
  const detail = run.reason ? ` (${run.reason}${run.message ? `: ${run.message}` : ''})` : ''
  const session = run.sessionId ? ` → ${run.sessionId}` : ''
  const missed = run.missedCount > 0 ? ` +${String(run.missedCount)} missed` : ''
  return `${time(run.firedAt)}  ${run.trigger}${missed}  ${run.status}${detail}${session}`
}

function humanResponse(response: ScheduledTasksResponse) {
  const outcome = response.outcome
  if (outcome.effect === 'listed') {
    return outcome.tasks.length === 0
      ? 'No Scheduled tasks.'
      : outcome.tasks.map(taskLine).join('\n')
  }
  if (outcome.effect === 'read') {
    const runs =
      outcome.runs.length === 0
        ? ['  No runs yet.']
        : outcome.runs.map((run) => `  ${runLine(run)}`)
    return [taskDetails(outcome.task), 'Runs:', ...runs].join('\n')
  }
  if (outcome.effect === 'runs-listed') {
    return outcome.runs.length === 0 ? 'No runs.' : outcome.runs.map(runLine).join('\n')
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
    : responses.map(humanResponse).join('\n')
  return writeCliStdout(`${output}\n`)
}
