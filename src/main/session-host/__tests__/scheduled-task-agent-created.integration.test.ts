import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import {
  registerProjects,
  runSql,
  setUpPiDiscoveryFixture,
} from '../../adapters/pi/__tests__/pi-session-discovery.test-support'
import {
  AGENT_RUN,
  agentTaskFixture,
  deleteSession,
  dispatched,
  fireAfterConcurrentEdit,
  readTask,
  setCeiling,
  storedRunsAs,
} from './scheduled-task-agent-created.test-support'
import {
  createIdleSession,
  fire,
  heartbeatInput,
  scheduledTasks,
  setSessionModel,
  setTaskDue,
} from './scheduled-tasks.test-support'

const { state } = vi.hoisted(() => ({
  state: { userDataDir: '' },
}))

// Each test keeps its files under its own `userData`.
vi.mock('../../desktop-shell/app-paths', async () => {
  const { fakeAppPaths } = await import('../../test-support/fake-desktop-shell')
  return { appPaths: { ...fakeAppPaths(), userData: () => state.userDataDir } }
})

vi.mock('../scheduled-task-dispatch', async () =>
  (await import('./scheduled-task-agent-created.test-support')).fakeScheduledTaskDispatch(),
)

const fixture = setUpPiDiscoveryFixture(state)
const { agentSession, createLaunch } = agentTaskFixture(fixture)

describe('a Scheduled task a Session agent created', () => {
  it('runs as the local user and keeps running after its creating Session is deleted', async () => {
    await registerProjects([fixture.project])
    const { sessionId, caller } = await agentSession('yolo')
    const task = await createLaunch(caller)
    expect(task.creator).toMatchObject({ kind: 'session-agent', sessionId })
    expect(await storedRunsAs(task.id)).toEqual({
      creator_caller_id: 'local-user',
      creator_kind: 'session-agent',
      authority_limits_json: null,
    })

    await deleteSession(sessionId)
    // Fired by its schedule, not a Run now, whose key is whoever asks.
    const dueAt = Date.now() - 1000
    await setTaskDue(task.id, dueAt)
    expect(await fire(task.id, dueAt + 500)).toBe('recorded')

    const read = await readTask(task.id)
    expect(read.task.attention).toBeNull()
    expect(read.runs[0]).toMatchObject({ status: 'started' })
    expect(dispatched.at(-1)?.caller).toEqual({
      callerId: 'local-user',
      workingDirectory: fixture.project,
    })
    // It runs as the person, but its key says it is the agent's work: the Worker limits apply.
    expect(dispatched.at(-1)?.payload).toMatchObject({
      request: { idempotencyKey: expect.stringMatching(/^scheduled-task-run:session-agent:/) },
    })
  })

  it('keeps a narrower agent authority as limits after its Session is gone', async () => {
    await registerProjects([fixture.project])
    const { sessionId, caller } = await agentSession('ask-for-approval')
    const task = await createLaunch(caller)
    const stored = await storedRunsAs(task.id)
    expect(stored?.creator_caller_id).toBe('local-user')
    expect(JSON.parse(stored?.authority_limits_json ?? 'null')).toMatchObject({
      authorizationCeiling: 'ask-for-approval',
      scope: { all: true },
    })

    await deleteSession(sessionId)
    expect(await fire(task.id, Date.now(), 'run-now')).toBe('recorded')

    expect((await readTask(task.id)).runs[0]).toMatchObject({ status: 'started' })
    const runCaller = dispatched.at(-1)?.caller
    expect(runCaller?.callerId).toBe('local-user')
    expect(runCaller?.profileAuthority).toMatchObject({
      authorizationCeiling: 'ask-for-approval',
      scope: { all: true },
    })
    expect(runCaller?.profileAuthority?.capabilities).toContain('sessions:start')
  })

  it('says when it runs within its creator’s access, and keeps that across a pause', async () => {
    await registerProjects([fixture.project])
    const { caller } = await agentSession('ask-for-approval')
    const task = await createLaunch(caller)
    expect(task.creator.label).toContain('(runs with limited access)')
    await scheduledTasks({ operation: 'update', taskId: task.id, patch: { enabled: false } })
    await scheduledTasks({ operation: 'update', taskId: task.id, patch: { enabled: true } })
    expect((await storedRunsAs(task.id))?.authority_limits_json).not.toBeNull()
  })

  it('runs as you, with your whole authority, once you change its prompt', async () => {
    await registerProjects([fixture.project])
    const { caller } = await agentSession('ask-for-approval')
    const task = await createLaunch(caller)
    const updated = await scheduledTasks({
      operation: 'update',
      taskId: task.id,
      patch: { prompt: 'Triage the new errors, then stop.' },
    })
    expect(updated).toMatchObject({ effect: 'updated' })
    expect(await storedRunsAs(task.id)).toMatchObject({
      creator_caller_id: 'gui:local-user',
      creator_kind: 'session-agent',
      authority_limits_json: null,
    })
  })

  it('keeps a Heartbeat’s limits when you save an edit to its name and schedule only', async () => {
    await registerProjects([fixture.project])
    const { caller } = await agentSession('ask-for-approval')
    const target = await createIdleSession(fixture.project)
    await setSessionModel(target)
    await setCeiling(target, 'ask-for-approval')
    const input = heartbeatInput(target)
    if (!input.heartbeat) throw new Error('Expected heartbeat settings.')
    const created = await scheduledTasks({ operation: 'create', input }, caller)
    if (created.effect !== 'created') throw new Error(JSON.stringify(created))
    const limits = JSON.parse(
      (await storedRunsAs(created.task.id))?.authority_limits_json ?? 'null',
    )
    expect(limits).toMatchObject({ authorizationCeiling: 'ask-for-approval' })

    // The app's editor sends every field, the unchanged stop condition included.
    const saved = await scheduledTasks({
      operation: 'update',
      taskId: created.task.id,
      patch: {
        name: 'Watch CI hourly',
        prompt: input.prompt,
        enabled: true,
        schedule: { kind: 'interval', everyMinutes: 60 },
        timeZone: 'UTC',
        endsAt: null,
        maxRuns: null,
        target: { kind: 'heartbeat', sessionId: target },
        notificationPolicy: 'failures-only',
        heartbeat: {
          ...(input.heartbeat.stopWhen === undefined ? {} : { stopWhen: input.heartbeat.stopWhen }),
          indefinite: false,
          idlePauseAfter: 3,
        },
      },
    })
    expect(saved).toMatchObject({ effect: 'updated' })
    const kept = (await storedRunsAs(created.task.id))?.authority_limits_json
    expect(JSON.parse(kept ?? 'null')).toEqual(limits)

    await scheduledTasks({
      operation: 'update',
      taskId: created.task.id,
      patch: { heartbeat: { stopWhen: 'The release is out.' } },
    })
    expect((await storedRunsAs(created.task.id))?.authority_limits_json).toBeNull()
  })

  it('adopts a task stored naming an agent whose Session was deleted', async () => {
    await registerProjects([fixture.project])
    const { sessionId, caller } = await agentSession('yolo')
    const task = await createLaunch(caller)
    // As stored before tasks ran as the agent's owner.
    await runSql((sql) =>
      sql`UPDATE scheduled_tasks SET creator_caller_id = ${`session-agent:${sessionId}:${AGENT_RUN}`}
        WHERE id = ${task.id}`.pipe(Effect.asVoid),
    )
    await deleteSession(sessionId)

    expect(await fire(task.id, Date.now(), 'run-now')).toBe('recorded')

    expect((await readTask(task.id)).runs[0]).toMatchObject({ status: 'started' })
    expect(await storedRunsAs(task.id)).toMatchObject({
      creator_caller_id: 'local-user',
      authority_limits_json: null,
    })
  })

  it('adopts a task stored naming a live agent with that agent’s limits', async () => {
    await registerProjects([fixture.project])
    const { sessionId, caller } = await agentSession('ask-for-approval')
    const task = await createLaunch(caller)
    await runSql((sql) =>
      sql`UPDATE scheduled_tasks SET authority_limits_json = NULL,
        creator_caller_id = ${`session-agent:${sessionId}:${AGENT_RUN}`}
        WHERE id = ${task.id}`.pipe(Effect.asVoid),
    )

    expect(await fire(task.id, Date.now(), 'run-now')).toBe('recorded')

    const stored = await storedRunsAs(task.id)
    expect(stored?.creator_caller_id).toBe('local-user')
    expect(JSON.parse(stored?.authority_limits_json ?? 'null')).toMatchObject({
      authorizationCeiling: 'ask-for-approval',
    })
  })

  it('lets an edit or deletion that wins the adoption race decide the firing', async () => {
    await registerProjects([fixture.project])
    const { sessionId, caller } = await agentSession('yolo')
    const disabled = await createLaunch(caller)
    const deleted = await createLaunch(caller, 'Weekly triage')
    const rescheduled = await createLaunch(caller, 'Hourly triage')
    const legacy = `session-agent:${sessionId}:${AGENT_RUN}`
    await runSql((sql) =>
      sql`UPDATE scheduled_tasks SET creator_caller_id = ${legacy}`.pipe(Effect.asVoid),
    )
    const before = dispatched.length

    expect(
      await fireAfterConcurrentEdit(
        disabled.id,
        (sql) =>
          sql`UPDATE scheduled_tasks SET enabled = 0, updated_at = updated_at + 5
          WHERE id = ${disabled.id}`,
      ),
    ).toBe('recorded')
    expect(
      await fireAfterConcurrentEdit(
        rescheduled.id,
        (sql) =>
          sql`UPDATE scheduled_tasks SET next_run_at = next_run_at + 3600000,
          updated_at = updated_at + 5 WHERE id = ${rescheduled.id}`,
      ),
    ).toBe('recorded')
    expect(
      await fireAfterConcurrentEdit(
        deleted.id,
        (sql) => sql`DELETE FROM scheduled_tasks WHERE id = ${deleted.id}`,
      ),
    ).toBe('recorded')

    expect(dispatched).toHaveLength(before)
    expect((await readTask(disabled.id)).runs).toEqual([])
    expect((await readTask(rescheduled.id)).runs).toEqual([])
  })
})
