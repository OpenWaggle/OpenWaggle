import * as SqlClient from '@effect/sql/SqlClient'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import {
  SCHEDULED_TASKS_CONTRACT_VERSION,
  type ScheduledTaskInput,
  type ScheduledTasksCommand,
} from '@shared/types/scheduled-task'
import { SESSION_LIFECYCLE_CONTRACT_VERSION } from '@shared/types/session-lifecycle'
import * as Effect from 'effect/Effect'
import { run, runSql } from '../../adapters/pi/__tests__/pi-session-discovery.test-support'

export const LOCAL_USER: LocalSessionCallerIdentity = { callerId: 'gui:local-user' }

let requestCounter = 0

export async function scheduledTasks(
  command: ScheduledTasksCommand,
  caller: LocalSessionCallerIdentity = LOCAL_USER,
  idempotencyKey?: string,
) {
  const { dispatchLocalSessionCommand } = await import(
    '../../application/local-session-command-dispatcher'
  )
  requestCounter += 1
  const result = await run(
    dispatchLocalSessionCommand({
      caller,
      payload: {
        contract: 'scheduled-tasks-v1',
        request: {
          contractVersion: SCHEDULED_TASKS_CONTRACT_VERSION,
          requestId: `request-${String(requestCounter)}`,
          ...(idempotencyKey ? { idempotencyKey } : {}),
          command,
        },
      },
    }),
  )
  if (result.contract !== 'scheduled-tasks-v1') throw new Error('Unexpected contract.')
  return result.response.outcome
}

export async function createIdleSession(projectPath: string) {
  const { dispatchLocalSessionCommand } = await import(
    '../../application/local-session-command-dispatcher'
  )
  requestCounter += 1
  const result = await run(
    dispatchLocalSessionCommand({
      caller: { ...LOCAL_USER, workingDirectory: projectPath },
      payload: {
        contract: 'session-lifecycle-v2',
        request: {
          contractVersion: SESSION_LIFECYCLE_CONTRACT_VERSION,
          requestId: `create-${String(requestCounter)}`,
          idempotencyKey: `create-${String(requestCounter)}`,
          command: { operation: 'create', projectPath, title: 'Monitored Session' },
        },
      },
    }),
  )
  if (
    result.contract !== 'session-lifecycle-v2' ||
    result.response.outcome.effect !== 'created-root'
  ) {
    throw new Error(`Could not create a Session: ${JSON.stringify(result)}`)
  }
  return result.response.outcome.sessionId
}

export function heartbeatInput(sessionId: string, overrides: Partial<ScheduledTaskInput> = {}) {
  return {
    name: 'Watch CI',
    prompt: 'Check the CI status and report only changes.',
    enabled: true,
    schedule: { kind: 'interval', everyMinutes: 30 },
    timeZone: 'UTC',
    target: { kind: 'heartbeat', sessionId },
    heartbeat: { stopWhen: 'CI is green on main.' },
    ...overrides,
  } satisfies ScheduledTaskInput
}

/** Makes a task due at `at`, as if it had been created (anchored) then. */
export function setTaskDue(taskId: string, at: number) {
  return runSql((sql) =>
    sql`UPDATE scheduled_tasks SET next_run_at = ${at}, next_nominal_at = ${at}, anchor_at = ${at}
      WHERE id = ${taskId}`.pipe(Effect.asVoid),
  )
}

/** Gives a Session the durable model a Run needs, which a test install has no provider for. */
export function setSessionModel(sessionId: string) {
  return runSql((sql) =>
    sql`UPDATE session_execution_profiles
      SET profile_json = ${JSON.stringify({ modelId: 'test/test-model', thinkingLevel: 'medium' })}
      WHERE session_id = ${sessionId}`.pipe(Effect.asVoid),
  )
}

export function archiveSessionRow(sessionId: string) {
  return runSql((sql) =>
    sql`UPDATE sessions SET archived = 1 WHERE id = ${sessionId}`.pipe(Effect.asVoid),
  )
}

export async function fire(
  taskId: string,
  now: number,
  trigger: 'schedule' | 'run-now' = 'schedule',
) {
  const { fireScheduledTask } = await import('../scheduled-task-firing')
  const { ScheduledTaskRepository } = await import('../../ports/scheduled-task-repository')
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const repository = yield* ScheduledTaskRepository
      const record = yield* repository.get(taskId)
      if (!record) throw new Error('No such task.')
      return yield* fireScheduledTask(sql, { record, trigger, now })
    }),
  )
}
