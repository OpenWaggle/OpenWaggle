import { matchBy } from '@diegogbrisa/ts-match'
import {
  isTaskScheduleJittered,
  SCHEDULED_TASK_JITTER_TEXT,
} from '@shared/domain/scheduled-tasks/task-schedule'
import type {
  LocalScheduledTasksCommandResult,
  ScheduledTask,
  ScheduledTaskRun,
  ScheduledTasksOutcome,
  TaskSchedule,
} from '@shared/types/scheduled-task'
import { zonedTimestamp } from '@shared/utils/zoned-time'

const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

/**
 * `YYYY-MM-DD HH:MM:SS ±HH:MM` on the wall clock of `timeZone`, the zone the task's schedule is
 * read in. Seconds show a jittered time exactly; the offset tells a repeated hour's two
 * occurrences apart when clocks go back.
 */
function wallClock(epoch: number, timeZone: string) {
  try {
    return zonedTimestamp(epoch, timeZone)
  } catch {
    return new Date(epoch).toISOString()
  }
}

function nextRun(task: ScheduledTask) {
  if (task.nextRunAt === null) return { nextRunAt: null }
  return {
    nextRunAt: wallClock(task.nextRunAt, task.timeZone),
    ...(task.nextNominalAt !== null && task.nextNominalAt !== task.nextRunAt
      ? { nextNominalAt: wallClock(task.nextNominalAt, task.timeZone) }
      : {}),
    ...(isTaskScheduleJittered(task) ? { nextRunJitter: SCHEDULED_TASK_JITTER_TEXT } : {}),
  }
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
    ...(run.wakeCheck ? { wakeCheck: run.wakeCheck } : {}),
    ...(run.outcome ? { outcome: run.outcome.value, outcomeSource: run.outcome.source } : {}),
  }
}

/** A Heartbeat's way to finish, Wake check and Auto-pause, as the model reads them (#388). */
function compactHeartbeat(task: ScheduledTask) {
  const heartbeat = task.heartbeat
  if (!heartbeat) return {}
  return {
    ...(heartbeat.stopWhen ? { stopWhen: heartbeat.stopWhen } : {}),
    ...(heartbeat.indefinite ? { indefinite: true } : {}),
    idlePauseAfter: heartbeat.idlePauseAfter,
    consecutiveIdleRuns: heartbeat.consecutiveIdleRuns,
    ...(heartbeat.wakeCheck
      ? {
          wakeIf: heartbeat.wakeCheck.command,
          wakeOnFailure: heartbeat.wakeCheck.onFailure,
          wakeCheckApproval: heartbeat.wakeCheck.approval,
        }
      : {}),
    ...(heartbeat.autoPause ? { autoPaused: heartbeat.autoPause.message } : {}),
  }
}

function compactTarget(task: ScheduledTask) {
  const { target } = task
  if (target.kind === 'heartbeat') {
    return {
      sessionId: target.sessionId,
      ...(target.modelId ? { model: target.modelId } : {}),
      ...(target.thinkingLevel ? { thinking: target.thinkingLevel } : {}),
    }
  }
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
    ...nextRun(task),
    ...(task.endsAt !== null ? { endsAt: wallClock(task.endsAt, task.timeZone) } : {}),
    ...(task.maxRuns !== null ? { maxRuns: task.maxRuns } : {}),
    runCount: task.runCount,
    ...compactTarget(task),
    ...compactHeartbeat(task),
    ...(task.attention
      ? { attention: { reason: task.attention.reason, message: task.attention.message } }
      : {}),
    ...(task.lastRun
      ? {
          lastRun: {
            status: task.lastRun.status,
            trigger: task.lastRun.trigger,
            firedAt: wallClock(task.lastRun.firedAt, task.timeZone),
            ...(task.lastRun.reason ? { reason: task.lastRun.reason } : {}),
            ...(task.lastRun.outcome ? { outcome: task.lastRun.outcome.value } : {}),
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
      .with('outcome-recorded', ({ effect, task, run }) => ({
        effect,
        task: compactTask(task),
        run: compactRun(run, task.timeZone),
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
