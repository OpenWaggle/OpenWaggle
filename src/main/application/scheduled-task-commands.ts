import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import {
  SCHEDULED_TASK_LIST_LIMIT,
  SCHEDULED_TASK_RECENT_SESSION_LIMIT,
  SCHEDULED_TASKS_CONTRACT_VERSION,
  type ScheduledTasksOutcome,
  type ScheduledTasksRequest,
  type ScheduledTasksResponse,
} from '@shared/types/scheduled-task'
import type { SessionCapability } from '@shared/types/session-capability'
import * as Effect from 'effect/Effect'
import { authorizeSessionCapabilities } from '../domain/session-control/session-capability-authorization'
import {
  type ScheduledTaskRecord,
  ScheduledTaskRepository,
} from '../ports/scheduled-task-repository'
import { scheduledTaskHooks } from './scheduled-task-hooks'
import {
  createScheduledTask,
  rejectedOutcome,
  updateScheduledTask,
} from './scheduled-task-mutations'
import { presentScheduledTask } from './scheduled-task-presentation'
import {
  resolveScheduledTaskPrincipal,
  type ScheduledTaskPrincipal,
} from './scheduled-task-principal'

const DEFAULT_RUN_PAGE = 20

type Command = ScheduledTasksRequest['command']

function requiredCapability(command: Command): SessionCapability {
  return command.operation === 'list' ||
    command.operation === 'read' ||
    command.operation === 'runs'
    ? 'schedules:read'
    : 'schedules:manage'
}

function visible(principal: ScheduledTaskPrincipal, record: ScheduledTaskRecord) {
  return principal.localUser || record.ownerKey === principal.ownerKey
}

function notFound() {
  return rejectedOutcome('task_not_found', 'No such Scheduled task.')
}

function listTasks(
  principal: ScheduledTaskPrincipal,
  command: Extract<Command, { operation: 'list' }>,
) {
  return Effect.gen(function* () {
    const repository = yield* ScheduledTaskRepository
    const records = yield* repository.list({
      ...(principal.localUser ? {} : { ownerKey: principal.ownerKey }),
      ...(command.projectPath ? { projectPath: command.projectPath } : {}),
      ...(command.sessionId ? { targetSessionId: command.sessionId } : {}),
      limit: SCHEDULED_TASK_LIST_LIMIT,
    })
    const ids = records.map((record) => record.id)
    const lastRuns = yield* repository.lastRuns(ids)
    const sessions = yield* repository.recentSessionIds(ids, SCHEDULED_TASK_RECENT_SESSION_LIMIT)
    return {
      effect: 'listed',
      tasks: records.map((record) =>
        presentScheduledTask(
          record,
          lastRuns.get(record.id) ?? null,
          sessions.get(record.id) ?? [],
        ),
      ),
    } satisfies ScheduledTasksOutcome
  })
}

function readTask(principal: ScheduledTaskPrincipal, taskId: string) {
  return Effect.gen(function* () {
    const repository = yield* ScheduledTaskRepository
    const record = yield* repository.get(taskId)
    if (!record || !visible(principal, record)) return notFound()
    const runs = yield* repository.listRuns({ taskId, limit: DEFAULT_RUN_PAGE })
    const sessions = yield* repository.recentSessionIds(
      [taskId],
      SCHEDULED_TASK_RECENT_SESSION_LIMIT,
    )
    return {
      effect: 'read',
      task: presentScheduledTask(record, runs[0] ?? null, sessions.get(taskId) ?? []),
      runs,
    } satisfies ScheduledTasksOutcome
  })
}

function listRuns(
  principal: ScheduledTaskPrincipal,
  command: Extract<Command, { operation: 'runs' }>,
) {
  return Effect.gen(function* () {
    const repository = yield* ScheduledTaskRepository
    const record = yield* repository.get(command.taskId)
    if (!record || !visible(principal, record)) return notFound()
    const runs = yield* repository.listRuns({
      taskId: command.taskId,
      limit: command.limit ?? DEFAULT_RUN_PAGE,
      ...(command.before !== undefined ? { before: command.before } : {}),
    })
    return { effect: 'runs-listed', runs } satisfies ScheduledTasksOutcome
  })
}

function deleteTask(principal: ScheduledTaskPrincipal, taskId: string) {
  return Effect.gen(function* () {
    const repository = yield* ScheduledTaskRepository
    const record = yield* repository.get(taskId)
    if (!record || !visible(principal, record)) return notFound()
    yield* repository.delete(taskId)
    scheduledTaskHooks().tasksChanged()
    return { effect: 'deleted', taskId } satisfies ScheduledTasksOutcome
  })
}

function runNow(principal: ScheduledTaskPrincipal, taskId: string) {
  return Effect.gen(function* () {
    const repository = yield* ScheduledTaskRepository
    const record = yield* repository.get(taskId)
    if (!record || !visible(principal, record)) return notFound()
    const accepted = yield* scheduledTaskHooks().requestRunNow(taskId)
    if (accepted === 'busy') {
      return rejectedOutcome('run_already_in_progress', 'This task is already running.')
    }
    if (accepted === 'unavailable') {
      return rejectedOutcome(
        'scheduler_unavailable',
        'The Session Host scheduler is not running, or the Host is stopping.',
      )
    }
    const lastRuns = yield* repository.lastRuns([taskId])
    return {
      effect: 'run-requested',
      task: presentScheduledTask(record, lastRuns.get(taskId) ?? null),
    } satisfies ScheduledTasksOutcome
  })
}

function executeCommand(principal: ScheduledTaskPrincipal, request: ScheduledTasksRequest) {
  const command = request.command
  if (command.operation === 'list') return listTasks(principal, command)
  if (command.operation === 'read') return readTask(principal, command.taskId)
  if (command.operation === 'runs') return listRuns(principal, command)
  if (command.operation === 'delete') return deleteTask(principal, command.taskId)
  if (command.operation === 'run-now') return runNow(principal, command.taskId)
  if (command.operation === 'create') {
    return createScheduledTask({
      principal,
      task: command.input,
      ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
    })
  }
  return Effect.gen(function* () {
    const repository = yield* ScheduledTaskRepository
    const current = yield* repository.get(command.taskId)
    if (!current || !visible(principal, current)) return notFound()
    return yield* updateScheduledTask({ principal, current, patch: command.patch })
  })
}

/** Executes one `scheduled-tasks-v1` request for an authenticated caller (ADR 0057). */
export function executeScheduledTasksRequest(input: {
  readonly caller: LocalSessionCallerIdentity
  readonly request: ScheduledTasksRequest
}) {
  return Effect.gen(function* () {
    const { request } = input
    const respond = (outcome: ScheduledTasksOutcome): ScheduledTasksResponse => ({
      contractVersion: SCHEDULED_TASKS_CONTRACT_VERSION,
      requestId: request.requestId,
      operation: request.command.operation,
      outcome,
    })
    const capability = authorizeSessionCapabilities(input.caller.profileAuthority, [
      requiredCapability(request.command),
    ])
    if (!capability.authorized) {
      return respond(
        rejectedOutcome(
          'capability_denied',
          `This caller lacks ${requiredCapability(request.command)}.`,
        ),
      )
    }
    const resolution = yield* resolveScheduledTaskPrincipal(input.caller)
    if (!resolution.supported) {
      return respond(rejectedOutcome('creator_identity_unsupported', resolution.message))
    }
    return respond(yield* executeCommand(resolution.principal, request))
  })
}
