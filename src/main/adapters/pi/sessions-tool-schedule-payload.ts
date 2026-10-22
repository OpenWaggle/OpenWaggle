import type {
  LocalSessionCommandPayload,
  LocalSessionCommandResult,
} from '@shared/types/local-session-protocol'
import type { ScheduledTasksOperation, ScheduledTaskTarget } from '@shared/types/scheduled-task'
import type { SessionsToolParameters } from './sessions-tool-parameters'
import type { SessionsToolSource } from './sessions-tool-payload'
import {
  buildScheduledTasksCommand,
  scheduledTasksPayload,
  scheduleUpdateChangesTarget,
} from './sessions-tool-schedule-command'

export type SessionsToolScheduleInput = Extract<
  SessionsToolParameters,
  { action: `schedule_${string}` }
>

const SCHEDULE_OPERATIONS = {
  schedule_list: 'list',
  schedule_read: 'read',
  schedule_runs: 'runs',
  schedule_create: 'create',
  schedule_update: 'update',
  schedule_delete: 'delete',
  schedule_run_now: 'run-now',
} as const satisfies Record<SessionsToolScheduleInput['action'], ScheduledTasksOperation>

export function isSessionsToolScheduleAction(
  input: SessionsToolParameters,
): input is SessionsToolScheduleInput {
  return Object.hasOwn(SCHEDULE_OPERATIONS, input.action)
}

/** A retried tool call creates its Scheduled task once. */
function createIdempotencyKey(input: SessionsToolScheduleInput, source: SessionsToolSource) {
  if (input.action !== 'schedule_create') return undefined
  if (input.idempotencyKey) return input.idempotencyKey
  return source.toolCallId ? `sessions-tool:${source.runId}:${source.toolCallId}` : undefined
}

export function buildSessionsToolSchedulePayload(
  input: SessionsToolScheduleInput,
  source: SessionsToolSource,
  currentTarget?: ScheduledTaskTarget,
): LocalSessionCommandPayload {
  const { action, ...fields } = input
  const command = buildScheduledTasksCommand({
    operation: SCHEDULE_OPERATIONS[action],
    fields,
    // An agent's Heartbeat watches its own Session unless it names another one.
    defaults: {
      heartbeatSessionId: source.sessionId,
      ...(source.projectPath ? { launchProjectPath: source.projectPath } : {}),
    },
    ...(currentTarget ? { currentTarget } : {}),
  })
  return scheduledTasksPayload(command, createIdempotencyKey(input, source))
}

/**
 * Sends one Scheduled task action. Changing a Launch schedule's target fields reads the task first
 * so the fields the caller left out keep their values; a refused read is returned as the result.
 */
export async function executeSessionsToolSchedule(
  input: SessionsToolScheduleInput,
  source: SessionsToolSource,
  execute: (payload: LocalSessionCommandPayload) => Promise<LocalSessionCommandResult>,
) {
  if (input.action !== 'schedule_update' || !scheduleUpdateChangesTarget(input)) {
    return execute(buildSessionsToolSchedulePayload(input, source))
  }
  const current = await execute(
    buildSessionsToolSchedulePayload(
      { action: 'schedule_read', scheduleTaskId: input.scheduleTaskId },
      source,
    ),
  )
  if (current.contract !== 'scheduled-tasks-v1') {
    throw new Error('The Session Host answered a Scheduled task read with another contract.')
  }
  if (current.response.outcome.effect !== 'read') return current
  return execute(
    buildSessionsToolSchedulePayload(input, source, current.response.outcome.task.target),
  )
}
