import {
  isTaskScheduleJittered,
  SCHEDULED_TASK_JITTER_TEXT,
} from '@shared/domain/scheduled-tasks/task-schedule'
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
  const jitter =
    task.nextRunAt !== null && isTaskScheduleJittered(task)
      ? ` (${SCHEDULED_TASK_JITTER_TEXT})`
      : ''
  return `next ${time(task.nextRunAt, task.timeZone)}${jitter}`
}

/** When a run fired and why: `schedule`, `catch-up`, or `run-now`, which fires at no set time. */
function runFiring(run: ScheduledTaskRun, timeZone: string | undefined) {
  return `${time(run.firedAt, timeZone)} ${run.trigger} ${run.status}`
}

function taskState(task: ScheduledTask) {
  if (task.attention) return 'needs attention'
  if (task.heartbeat?.autoPause) return task.heartbeat.autoPause.message
  if (task.heartbeat?.wakeCheck?.approval === 'pending')
    return 'waiting for you to approve its wake check'
  return task.enabled ? 'on' : 'paused'
}

function taskLine(task: ScheduledTask, options: { readonly lastRun: boolean }) {
  const state = taskState(task)
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

/** A Heartbeat's way to finish, Wake check and idle count (#388). */
function heartbeatLines(task: ScheduledTask) {
  const heartbeat = task.heartbeat
  if (!heartbeat) return []
  const ends =
    heartbeat.stopWhen !== null
      ? `Stops when: ${heartbeat.stopWhen}`
      : heartbeat.indefinite && task.endsAt === null && task.maxRuns === null
        ? 'Has no end (indefinite)'
        : null
  const model = task.target.kind === 'heartbeat' ? task.target.modelId : undefined
  return [
    ...(ends ? [`  ${ends}`] : []),
    ...(heartbeat.wakeCheck
      ? [
          `  Wake check (${heartbeat.wakeCheck.approval}, on failure ${heartbeat.wakeCheck.onFailure}): ${heartbeat.wakeCheck.command}`,
        ]
      : []),
    `  Idle runs: ${String(heartbeat.consecutiveIdleRuns)} of ${String(heartbeat.idlePauseAfter)} before it pauses itself`,
    ...(model ? [`  Model for its Runs: ${model}`] : []),
  ]
}

function taskDetails(task: ScheduledTask) {
  return [
    taskLine(task, { lastRun: false }),
    `  ${taskTarget(task)}`,
    ...heartbeatLines(task),
    `  Created by ${task.creator.label}; ${String(task.runCount)} run(s); notifies ${task.notificationPolicy}`,
    lastRunLine(task),
    ...(task.attention ? [`  Attention: ${task.attention.message}`] : []),
    `  Prompt: ${task.prompt.split('\n')[0] ?? ''}`,
  ].join('\n')
}

function runLine(run: ScheduledTaskRun, timeZone?: string) {
  const detail = run.reason ? ` (${run.reason}${run.message ? `: ${run.message}` : ''})` : ''
  const outcome = run.outcome ? ` · ${run.outcome.value} (${run.outcome.source})` : ''
  const session = run.sessionId ? ` → ${run.sessionId}` : ''
  const missed = run.missedCount > 0 ? ` +${String(run.missedCount)} missed` : ''
  return `${time(run.firedAt, timeZone)}  ${run.trigger}${missed}  ${run.status}${detail}${session}${outcome}`
}

/**
 * The human-readable text of one `openwaggle schedules` response. `runsTimeZone` is the zone a
 * run page is shown in, which the page itself does not name; the machine's by default.
 */
export function formatSchedulesCliResponse(
  response: ScheduledTasksResponse,
  runsTimeZone?: string,
) {
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
      : outcome.runs.map((run) => runLine(run, runsTimeZone)).join('\n')
  }
  if (outcome.effect === 'created') return `Created ${taskDetails(outcome.task)}`
  if (outcome.effect === 'updated') return `Updated ${taskDetails(outcome.task)}`
  if (outcome.effect === 'deleted') return `Deleted ${outcome.taskId}`
  if (outcome.effect === 'run-requested') return `Running ${outcome.task.name} now.`
  if (outcome.effect === 'outcome-recorded') {
    return `Recorded ${outcome.run.outcome?.value ?? 'no'} outcome for ${outcome.task.name}.`
  }
  return `Refused (${outcome.code}): ${outcome.message}`
}

/** The Heartbeat settings an import sets again. */
function exportedHeartbeat(heartbeat: NonNullable<ScheduledTask['heartbeat']>) {
  return {
    stopWhen: heartbeat.stopWhen,
    indefinite: heartbeat.indefinite,
    idlePauseAfter: heartbeat.idlePauseAfter,
    wakeCheck: heartbeat.wakeCheck
      ? { command: heartbeat.wakeCheck.command, onFailure: heartbeat.wakeCheck.onFailure }
      : null,
  }
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
    ...(task.heartbeat ? { heartbeat: exportedHeartbeat(task.heartbeat) } : {}),
  }))
}

export function writeSchedulesCliResponses(
  command: string,
  responses: readonly ScheduledTasksResponse[],
  json: boolean,
  runsTimeZone?: string,
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
    : responses.map((response) => formatSchedulesCliResponse(response, runsTimeZone)).join('\n')
  return writeCliStdout(`${output}\n`)
}
