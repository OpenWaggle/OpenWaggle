import * as SqlClient from '@effect/sql/SqlClient'
import { RunId, SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import {
  registerProjects,
  run,
  runSql,
  setUpPiDiscoveryFixture,
} from '../../adapters/pi/__tests__/pi-session-discovery.test-support'
import {
  archiveSessionRow,
  createIdleSession,
  fire,
  heartbeatInput,
  scheduledTasks,
  setSessionModel,
  setTaskDue,
} from './scheduled-tasks.test-support'

const { state, getPathMock, dispatched } = vi.hoisted(() => {
  const payloads: unknown[] = []
  return { state: { userDataDir: '' }, getPathMock: vi.fn(() => ''), dispatched: payloads }
})

getPathMock.mockImplementation(() => state.userDataDir)

vi.mock('electron', () => ({
  app: { getPath: getPathMock },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

/** A started Run without a model: the request is recorded, the Session Control reply faked. */
vi.mock('../scheduled-task-dispatch', async () => {
  const { Effect: EffectModule } = await import('effect')
  return {
    dispatchScheduledTaskCommand: (input: {
      readonly payload: { readonly request: { readonly command: { readonly sessionId?: string } } }
    }) =>
      EffectModule.sync(() => {
        dispatched.push(input.payload)
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
              sessionId: input.payload.request.command.sessionId ?? 'session',
              runId: 'run-started',
              stateRevision: 1,
            },
          },
        }
      }),
  }
})

const fixture = setUpPiDiscoveryFixture(state)
const MINUTE = 60_000

async function createHeartbeat(sessionId: string) {
  const outcome = await scheduledTasks({ operation: 'create', input: heartbeatInput(sessionId) })
  if (outcome.effect !== 'created') throw new Error(JSON.stringify(outcome))
  return outcome.task
}

async function readTask(taskId: string) {
  const outcome = await scheduledTasks({ operation: 'read', taskId })
  if (outcome.effect !== 'read') throw new Error(JSON.stringify(outcome))
  return outcome
}

describe('Scheduled task commands', () => {
  it('creates, lists, reschedules, pauses, and deletes a Heartbeat', async () => {
    await registerProjects([fixture.project])
    const sessionId = await createIdleSession(fixture.project)
    const before = Date.now()
    const task = await createHeartbeat(sessionId)
    expect(task).toMatchObject({
      kind: 'heartbeat',
      enabled: true,
      projectPath: fixture.project,
      notificationPolicy: 'failures-only',
      creator: { kind: 'local-user' },
    })
    expect(task.nextRunAt).toBeGreaterThanOrEqual(before + 30 * MINUTE)

    const listed = await scheduledTasks({ operation: 'list', sessionId })
    expect(listed).toMatchObject({ effect: 'listed', tasks: [{ id: task.id }] })

    const rescheduled = await scheduledTasks({
      operation: 'update',
      taskId: task.id,
      patch: { schedule: { kind: 'daily', at: '09:00' } },
    })
    expect(rescheduled).toMatchObject({ effect: 'updated', task: { schedule: { kind: 'daily' } } })

    const paused = await scheduledTasks({
      operation: 'update',
      taskId: task.id,
      patch: { enabled: false },
    })
    expect(paused).toMatchObject({ effect: 'updated', task: { enabled: false, nextRunAt: null } })

    expect(await scheduledTasks({ operation: 'delete', taskId: task.id })).toEqual({
      effect: 'deleted',
      taskId: task.id,
    })
    expect(await scheduledTasks({ operation: 'read', taskId: task.id })).toMatchObject({
      effect: 'rejected',
      code: 'task_not_found',
    })
  })

  it('refuses schedules tighter than the kind allows, unknown Sessions, and a kind change', async () => {
    await registerProjects([fixture.project])
    const sessionId = await createIdleSession(fixture.project)
    expect(
      await scheduledTasks({
        operation: 'create',
        input: heartbeatInput(sessionId, { schedule: { kind: 'interval', everyMinutes: 2 } }),
      }),
    ).toMatchObject({ effect: 'rejected', code: 'invalid_schedule' })
    expect(
      await scheduledTasks({ operation: 'create', input: heartbeatInput('missing-session') }),
    ).toMatchObject({ effect: 'rejected', code: 'target_not_found' })
    const task = await createHeartbeat(sessionId)
    expect(
      await scheduledTasks({
        operation: 'update',
        taskId: task.id,
        patch: {
          target: {
            kind: 'launch',
            projectPath: fixture.project,
            workspace: 'local',
            archiveFinishedSessions: false,
          },
        },
      }),
    ).toMatchObject({ effect: 'rejected', code: 'kind_change_not_allowed' })
  })

  it('replays a create with the same idempotency key', async () => {
    await registerProjects([fixture.project])
    const sessionId = await createIdleSession(fixture.project)
    const command = { operation: 'create', input: heartbeatInput(sessionId) } as const
    const first = await scheduledTasks(command, undefined, 'create-once')
    const second = await scheduledTasks(command, undefined, 'create-once')
    expect(first.effect).toBe('created')
    expect(second).toMatchObject({ effect: 'created' })
    const listed = await scheduledTasks({ operation: 'list' })
    expect(listed.effect === 'listed' ? listed.tasks : []).toHaveLength(1)
  })

  it('needs schedules capabilities and a lasting caller identity', async () => {
    const authority = {
      profileId: 'transient',
      profileName: 'transient',
      scope: { all: true },
      authorizationCeiling: 'ask-for-approval' as const,
    }
    expect(
      await scheduledTasks(
        { operation: 'list' },
        {
          callerId: 'transient-mcp:abc',
          profileAuthority: { ...authority, capabilities: ['sessions:read'] },
        },
      ),
    ).toMatchObject({ effect: 'rejected', code: 'capability_denied' })
    expect(
      await scheduledTasks(
        { operation: 'list' },
        {
          callerId: 'transient-mcp:abc',
          profileAuthority: { ...authority, capabilities: ['schedules:read'] },
        },
      ),
    ).toMatchObject({ effect: 'rejected', code: 'creator_identity_unsupported' })
  })
})

describe('Scheduled task runs', () => {
  it('waits while its Session is busy, then starts a Run once it is idle', async () => {
    await registerProjects([fixture.project])
    const sessionId = await createIdleSession(fixture.project)
    const task = await createHeartbeat(sessionId)
    const due = Date.now()
    await setTaskDue(task.id, due)
    await runSql((sql) =>
      sql`INSERT INTO session_follow_ups (id, session_id, position, delivery_state, intent_json,
        created_at, updated_at) VALUES ('queued', ${sessionId}, 0, 'pending', '{}', 0, 0)`.pipe(
        Effect.asVoid,
      ),
    )
    expect(await fire(task.id, due + 1000)).toBe('waiting')
    expect((await readTask(task.id)).task.waitingSince).toBe(due + 1000)
    expect(dispatched).toHaveLength(0)

    await runSql((sql) => sql`DELETE FROM session_follow_ups`.pipe(Effect.asVoid))
    expect(await fire(task.id, due + 2 * MINUTE)).toBe('recorded')
    const read = await readTask(task.id)
    expect(read.task).toMatchObject({ runCount: 1, waitingSince: null })
    expect(read.task.nextNominalAt).toBe(due + 30 * MINUTE)
    expect(read.runs[0]).toMatchObject({ status: 'started', sessionId, runId: 'run-started' })
    expect(dispatched.at(-1)).toMatchObject({
      contract: 'session-control-v2',
      request: { command: { operation: 'start', sessionId } },
    })
  })

  it('collapses firings missed while the Host was down into one catch-up run', async () => {
    await registerProjects([fixture.project])
    const sessionId = await createIdleSession(fixture.project)
    const task = await createHeartbeat(sessionId)
    const now = Date.now()
    await setTaskDue(task.id, now - 3 * 60 * MINUTE - MINUTE)
    await fire(task.id, now)
    const read = await readTask(task.id)
    expect(read.runs).toHaveLength(1)
    // Due 3h01m ago every 30 minutes: six more firings passed since; one run stands for all.
    expect(read.runs[0]).toMatchObject({ trigger: 'catch-up', missedCount: 6, status: 'started' })
    expect(read.task.nextNominalAt).toBeGreaterThan(now)
  })

  it('stops a Heartbeat whose Session was archived', async () => {
    await registerProjects([fixture.project])
    const sessionId = await createIdleSession(fixture.project)
    const task = await createHeartbeat(sessionId)
    await archiveSessionRow(sessionId)
    await fire(task.id, Date.now())
    const read = await readTask(task.id)
    expect(read.task).toMatchObject({
      enabled: false,
      attention: { reason: 'target-session-archived' },
    })
    expect(read.runs[0]).toMatchObject({ status: 'failed', reason: 'target-session-archived' })
  })

  it('tells the started Run it came from the Scheduled task', async () => {
    await registerProjects([fixture.project])
    const sessionId = await createIdleSession(fixture.project)
    const task = await createHeartbeat(sessionId)
    await setSessionModel(sessionId)
    await fire(task.id, Date.now(), 'run-now')
    const key = await runSql((sql) =>
      sql<{ readonly idempotency_key: string }>`
        SELECT idempotency_key FROM scheduled_task_runs WHERE task_id = ${task.id}
      `.pipe(Effect.map((rows) => rows[0]?.idempotency_key ?? '')),
    )
    await runSql((sql) =>
      sql`INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
        VALUES ('run-scheduled', ${sessionId}, 'completed',
          ${JSON.stringify({ idempotencyKey: key, callerId: 'gui:local-user' })}, 0, 0)`.pipe(
        Effect.asVoid,
      ),
    )
    const { loadRunExecutionProfile } = await import(
      '../../adapters/session-control-run-executor-profile'
    )
    const profile = await run(
      Effect.flatMap(SqlClient.SqlClient, (sql) =>
        loadRunExecutionProfile(sql, {
          sessionId: SessionId(sessionId),
          runId: RunId('run-scheduled'),
        }),
      ),
    )
    expect(profile.runIdentityContext).toContain('"scheduledTask"')
    expect(profile.runIdentityContext).toContain('"name": "Watch CI"')
    expect(profile.runIdentityContext).toContain('"trigger": "run-now"')
  })
})
