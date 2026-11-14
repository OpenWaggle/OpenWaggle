import * as SqlClient from '@effect/sql/SqlClient'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { ScheduledTaskInput } from '@shared/types/scheduled-task'
import type { SessionCapability } from '@shared/types/session-capability'
import * as Effect from 'effect/Effect'
import {
  type PiDiscoveryFixture,
  run,
  runSql,
} from '../../adapters/pi/__tests__/pi-session-discovery.test-support'
import { createIdleSession, scheduledTasks, setSessionModel } from './scheduled-tasks.test-support'

/** Who each Scheduled task run acted as, recorded by `fakeScheduledTaskDispatch`. */
export const dispatched: {
  readonly caller: LocalSessionCallerIdentity
  readonly payload: unknown
}[] = []

/** A `../scheduled-task-dispatch` module that records each run's caller and fakes the reply. */
export function fakeScheduledTaskDispatch() {
  return {
    dispatchScheduledTaskCommand: (input: {
      readonly caller: LocalSessionCallerIdentity
      readonly payload: unknown
    }) =>
      Effect.sync(() => {
        dispatched.push(input)
        return {
          contract: 'session-control-v2',
          response: {
            contractVersion: 2,
            requestId: 'request',
            idempotencyKey: 'key',
            replayed: false,
            outcome: {
              operation: 'start',
              effect: 'started-run',
              sessionId: 'launched-session',
              runId: 'run-started',
              stateRevision: 1,
            },
          },
        }
      }),
  }
}
/** The Run in which the agent schedules work. */
export const AGENT_RUN = 'run-agent'

export function launchInput(projectPath: string) {
  return {
    name: 'Daily triage',
    prompt: 'Triage the new errors.',
    enabled: true,
    schedule: { kind: 'daily', at: '10:00' },
    timeZone: 'UTC',
    target: {
      kind: 'launch',
      projectPath,
      workspace: 'new-worktree',
      archiveFinishedSessions: true,
    },
  } satisfies ScheduledTaskInput
}

export function setCeiling(sessionId: string, ceiling: 'yolo' | 'ask-for-approval') {
  return runSql((sql) =>
    sql`UPDATE session_execution_profiles SET authorization_ceiling = ${ceiling}
      WHERE session_id = ${sessionId}`.pipe(Effect.asVoid),
  )
}

export function storedRunsAs(taskId: string) {
  return runSql((sql) =>
    sql<{
      readonly creator_caller_id: string
      readonly creator_kind: string
      readonly authority_limits_json: string | null
    }>`SELECT creator_caller_id, creator_kind, authority_limits_json FROM scheduled_tasks
      WHERE id = ${taskId}`.pipe(Effect.map((rows) => rows[0])),
  )
}

export function deleteSession(sessionId: string) {
  return runSql((sql) =>
    Effect.gen(function* () {
      yield* sql`DELETE FROM sessions WHERE id = ${sessionId}`
    }),
  )
}

export async function readTask(taskId: string) {
  const outcome = await scheduledTasks({ operation: 'read', taskId })
  if (outcome.effect !== 'read') throw new Error(JSON.stringify(outcome))
  return outcome
}

/** Fires a task from the record read before `edit` changed or deleted it, as a racing tick would. */
export async function fireAfterConcurrentEdit(
  taskId: string,
  edit: (sql: SqlClient.SqlClient) => Effect.Effect<unknown, unknown>,
) {
  const { fireScheduledTask } = await import('../scheduled-task-firing')
  const { ScheduledTaskRepository } = await import('../../ports/scheduled-task-repository')
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const repository = yield* ScheduledTaskRepository
      const record = yield* repository.get(taskId)
      if (!record) throw new Error('No such task.')
      yield* edit(sql)
      const now = Math.max(Date.now(), record.nextRunAt ?? 0)
      return yield* fireScheduledTask(sql, { record, trigger: 'schedule', now })
    }),
  )
}

/** Agent Sessions and tasks in the test's fixture project. */
export function agentTaskFixture(fixture: PiDiscoveryFixture) {
  /** Holds a Session's agent to its own project, as a launch by a project-limited caller would. */
  function limitToProject(sessionId: string) {
    const snapshot = {
      scope: { projectPaths: [fixture.project] },
      projectPath: fixture.project,
      workingPath: fixture.project,
    }
    return runSql((sql) =>
      sql`UPDATE session_execution_profiles
        SET authority_scope_snapshot_json = ${JSON.stringify(snapshot)}
        WHERE session_id = ${sessionId}`.pipe(Effect.asVoid),
    )
  }

  /** A desktop Session with a Run the local user started, whose agent then schedules work. */
  async function agentSession(
    ceiling: 'yolo' | 'ask-for-approval',
    options: {
      readonly projectLimited?: boolean
      /** The capability list its execution profile persisted, as an older Session's did. */
      readonly persistedCapabilities?: readonly SessionCapability[]
      /** Runs after the profile is written and before the agent's caller is resolved. */
      readonly beforeRun?: (sessionId: string) => Promise<unknown>
    } = {},
  ) {
    const sessionId = await createIdleSession(fixture.project)
    await setSessionModel(sessionId, options.persistedCapabilities)
    await options.beforeRun?.(sessionId)
    await setCeiling(sessionId, ceiling)
    if (options.projectLimited) await limitToProject(sessionId)
    await runSql((sql) =>
      Effect.gen(function* () {
        yield* sql`INSERT INTO session_runs (id, session_id, status, intent_json, created_at,
          updated_at) VALUES (${AGENT_RUN}, ${sessionId}, 'active',
          ${JSON.stringify({ callerId: 'gui:local-user' })}, 0, 0)`
      }),
    )
    const { resolveSessionToolAgentCaller } = await import('../session-tool-agent-caller')
    const caller = await run(
      Effect.flatMap(SqlClient.SqlClient, (sql) =>
        resolveSessionToolAgentCaller(sql, {
          sessionId,
          runId: AGENT_RUN,
          workingDirectory: fixture.project,
        }),
      ),
    )
    return { sessionId, caller }
  }

  async function createLaunch(caller: LocalSessionCallerIdentity, name?: string) {
    const input = launchInput(fixture.project)
    const outcome = await scheduledTasks(
      { operation: 'create', input: name ? { ...input, name } : input },
      caller,
    )
    if (outcome.effect !== 'created') throw new Error(JSON.stringify(outcome))
    return outcome.task
  }

  return { limitToProject, agentSession, createLaunch }
}
