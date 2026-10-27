import { inferHeartbeatRunOutcome } from '@shared/domain/scheduled-tasks/heartbeat-rules'
import type {
  ScheduledTaskRunOutcome,
  ScheduledTasksCommand,
  ScheduledTasksOutcome,
} from '@shared/types/scheduled-task'
import * as Effect from 'effect/Effect'
import {
  durableSessionRunId,
  isProfileCallerId,
  parseSessionAgentCallerId,
} from '../domain/session-control/root-session-project-reach'
import { ScheduledTaskRepository } from '../ports/scheduled-task-repository'
import { applyHeartbeatOutcome } from './scheduled-task-bookkeeping'
import { rejectedOutcome } from './scheduled-task-heartbeat-settings'
import { type HeartbeatRunEnd, scheduledTaskHooks } from './scheduled-task-hooks'
import { presentScheduledTask } from './scheduled-task-presentation'
import type { ScheduledTaskPrincipal } from './scheduled-task-principal'

type ApproveCommand = Extract<ScheduledTasksCommand, { operation: 'approve-wake-check' }>
type ReportCommand = Extract<ScheduledTasksCommand, { operation: 'report-outcome' }>

function visible(principal: ScheduledTaskPrincipal, ownerKey: string) {
  return principal.localUser || ownerKey === principal.ownerKey
}

function presentedTask(taskId: string) {
  return Effect.gen(function* () {
    const repository = yield* ScheduledTaskRepository
    const record = yield* repository.get(taskId)
    if (!record) return null
    const lastRuns = yield* repository.lastRuns([taskId])
    return presentScheduledTask(record, lastRuns.get(taskId) ?? null)
  })
}

/**
 * The user approves a Heartbeat's exact Wake check command, which releases it (#388). Only the
 * user may: in the app, with the CLI as themselves, or through the Hive tool's approval prompt in
 * the Session, which sends this only after the user approved there. A CLI client profile is an
 * outside agent, never the user, so it is refused.
 */
export function approveWakeCheck(principal: ScheduledTaskPrincipal, command: ApproveCommand) {
  return Effect.gen(function* () {
    const repository = yield* ScheduledTaskRepository
    if (isProfileCallerId(principal.caller.callerId)) {
      return rejectedOutcome(
        'capability_denied',
        'Only you can approve a Wake check: in OpenWaggle, or with openwaggle schedules approve-wake-check.',
      )
    }
    const current = yield* repository.get(command.taskId)
    if (!current || !visible(principal, current.ownerKey)) {
      return rejectedOutcome('task_not_found', 'No such Scheduled task.')
    }
    if (current.wakeCheck?.command !== command.command.trim()) {
      return rejectedOutcome(
        'wake_check_changed',
        'The Wake check is not this command any more; read the task and approve what it runs now.',
      )
    }
    const now = scheduledTaskHooks().now()
    const stored = yield* repository.update(current.id, current.updatedAt, {
      wakeCheck: {
        ...current.wakeCheck,
        approvedCommand: current.wakeCheck.command,
        pendingSince: null,
      },
      updatedAt: Math.max(now, current.updatedAt + 1),
    })
    if (!stored) return rejectedOutcome('task_not_found', 'The task changed; try again.')
    scheduledTaskHooks().tasksChanged()
    const task = yield* presentedTask(stored.id)
    return task
      ? ({ effect: 'updated', task } satisfies ScheduledTasksOutcome)
      : rejectedOutcome('task_not_found', 'No such Scheduled task.')
  })
}

function notScheduled() {
  return rejectedOutcome('run_not_scheduled', 'This Run was not started by one of your Heartbeats.')
}

/**
 * A Heartbeat Run reports its Run outcome (#388). Only that Run's own Session may, so one Session
 * cannot pause another's Heartbeat by claiming its Run. `done` pauses the Heartbeat now; `idle`
 * and `acted` count when the Run ends, once, whichever way the outcome was decided.
 */
export function reportHeartbeatOutcome(principal: ScheduledTaskPrincipal, command: ReportCommand) {
  return Effect.gen(function* () {
    const repository = yield* ScheduledTaskRepository
    const run = yield* repository.runOfSessionRun(durableSessionRunId(command.runId))
    if (!run) return notScheduled()
    const record = yield* repository.get(run.taskId)
    if (!record || record.kind !== 'heartbeat' || !visible(principal, record.ownerKey)) {
      return notScheduled()
    }
    const agent = parseSessionAgentCallerId(principal.caller.callerId)
    if (!principal.localUser && agent?.sessionId !== run.sessionId) return notScheduled()
    const note = command.note?.trim()
    yield* repository.recordRunOutcome(run.id, {
      value: command.outcome,
      source: 'reported',
      ...(note ? { note } : {}),
    })
    const now = scheduledTaskHooks().now()
    if (command.outcome === 'done') {
      yield* applyHeartbeatOutcome(record.id, 'done', { now, ...(note ? { note } : {}) })
    }
    scheduledTaskHooks().tasksChanged()
    const task = yield* presentedTask(record.id)
    const reported = yield* repository.getRun(run.id)
    if (!task || !reported) return notScheduled()
    return { effect: 'outcome-recorded', task, run: reported } satisfies ScheduledTasksOutcome
  })
}

/**
 * A Heartbeat Run ended (#388): its reported Run outcome, or else the one its tools imply, moves
 * the idle count once, and may Auto-pause the Heartbeat. A Run that failed or was stopped before
 * reporting has no outcome and leaves the count as it was.
 */
export function settleHeartbeatRunOutcome(end: HeartbeatRunEnd) {
  return Effect.gen(function* () {
    const repository = yield* ScheduledTaskRepository
    const run = yield* repository.runOfSessionRun(durableSessionRunId(end.runId))
    if (!run || run.sessionId !== end.sessionId) return
    let outcome: ScheduledTaskRunOutcome | null = run.outcome
    if (!outcome) {
      if (!end.completed) return
      outcome = { value: inferHeartbeatRunOutcome(end.toolUses), source: 'inferred' }
      yield* repository.recordRunOutcome(run.id, outcome)
    }
    yield* applyHeartbeatOutcome(run.taskId, outcome.value, {
      now: scheduledTaskHooks().now(),
      ...(outcome.note ? { note: outcome.note } : {}),
    })
    scheduledTaskHooks().tasksChanged()
  })
}
