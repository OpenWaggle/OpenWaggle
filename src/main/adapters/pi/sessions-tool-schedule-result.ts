import { matchBy } from '@diegogbrisa/ts-match'
import type {
  LocalScheduledTasksCommandResult,
  ScheduledTask,
  ScheduledTaskRun,
  ScheduledTasksOutcome,
  TaskSchedule,
} from '@shared/types/scheduled-task'

const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

/** `YYYY-MM-DD HH:MM` on the wall clock of `timeZone`, the zone the task's schedule is read in. */
function wallClock(epoch: number, timeZone: string) {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(epoch)
  } catch {
    return new Date(epoch).toISOString()
  }
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`
}

function describeSchedule(schedule: TaskSchedule) {
  if (schedule.kind === 'interval') return `every ${schedule.everyMinutes} min`
  if (schedule.kind === 'rrule') return `rrule ${schedule.rule}`
  const days = schedule.weekdays?.map((day) => WEEKDAY_NAMES[day - 1]).join(',')
  return `daily ${schedule.at}${days ? ` on ${days}` : ''}`
}

function compactRun(run: ScheduledTaskRun, timeZone: string) {
  return {
    id: run.id,
    status: run.status,
    trigger: run.trigger,
    firedAt: wallClock(run.firedAt, timeZone),
    ...(run.nominalAt !== run.firedAt ? { nominalAt: wallClock(run.nominalAt, timeZone) } : {}),
    ...(run.missedCount > 0 ? { missed: run.missedCount } : {}),
    ...(run.reason ? { reason: run.reason } : {}),
    ...(run.message ? { message: run.message } : {}),
    ...(run.sessionId ? { sessionId: run.sessionId } : {}),
    ...(run.runId ? { runId: run.runId } : {}),
  }
}

function compactTarget(task: ScheduledTask) {
  const { target } = task
  if (target.kind === 'heartbeat') return { sessionId: target.sessionId }
  return {
    projectPath: target.projectPath,
    workspace: target.workspace,
    ...(target.modelId ? { model: target.modelId } : {}),
    ...(target.thinkingLevel ? { thinking: target.thinkingLevel } : {}),
    ...(target.agentDefinitionName ? { agent: target.agentDefinitionName } : {}),
    ...(target.archiveFinishedSessions ? { archiveFinishedSessions: true } : {}),
  }
}

function compactTask(task: ScheduledTask, options: { readonly prompt?: boolean } = {}) {
  return {
    id: task.id,
    name: task.name,
    kind: task.kind,
    enabled: task.enabled,
    schedule: describeSchedule(task.schedule),
    timeZone: task.timeZone,
    nextRunAt: task.nextRunAt === null ? null : wallClock(task.nextRunAt, task.timeZone),
    ...(task.endsAt !== null ? { endsAt: wallClock(task.endsAt, task.timeZone) } : {}),
    ...(task.maxRuns !== null ? { maxRuns: task.maxRuns } : {}),
    runCount: task.runCount,
    ...compactTarget(task),
    ...(task.attention
      ? { attention: { reason: task.attention.reason, message: task.attention.message } }
      : {}),
    ...(task.lastRun
      ? {
          lastRun: {
            status: task.lastRun.status,
            firedAt: wallClock(task.lastRun.firedAt, task.timeZone),
            ...(task.lastRun.reason ? { reason: task.lastRun.reason } : {}),
          },
        }
      : {}),
    ...(options.prompt ? { prompt: task.prompt } : {}),
  }
}

function compactOutcome(outcome: ScheduledTasksOutcome) {
  return (
    matchBy(outcome, 'effect')
      .with('listed', ({ effect, tasks }) => ({
        effect,
        tasks: tasks.map((task) => compactTask(task)),
      }))
      .with('read', ({ effect, task, runs }) => ({
        effect,
        task: compactTask(task, { prompt: true }),
        runs: runs.map((run) => compactRun(run, task.timeZone)),
      }))
      // A run page names no zone of its own, so its times read in UTC.
      .with('runs-listed', ({ effect, runs }) => ({
        effect,
        timeZone: 'UTC',
        runs: runs.map((run) => compactRun(run, 'UTC')),
      }))
      .with('created', 'updated', 'run-requested', ({ effect, task }) => ({
        effect,
        task: compactTask(task),
      }))
      .with('deleted', ({ effect, taskId }) => ({ effect, taskId }))
      .with('rejected', ({ effect, code, message }) => ({ effect, code, message }))
      .exhaustive()
  )
}

/** A compact model-facing view of a Scheduled task result; the full result stays in details. */
export function renderScheduledTasksToolResult(result: LocalScheduledTasksCommandResult) {
  return JSON.stringify({
    operation: result.response.operation,
    ...compactOutcome(result.response.outcome),
  })
}

/** Scheduled task results reach the model compactly; details keep the full Host response. */
export function scheduledTasksToolResult(result: LocalScheduledTasksCommandResult) {
  return {
    content: [{ type: 'text' as const, text: renderScheduledTasksToolResult(result) }],
    details: result,
  }
}
