import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  registerProjects,
  runSql,
  setUpPiDiscoveryFixture,
} from '../../adapters/pi/__tests__/pi-session-discovery.test-support'
import {
  installHeartbeatHooks,
  recordSessionRun,
  runProfile,
  settleRunEnd,
} from './scheduled-task-heartbeat.test-support'
import {
  createIdleSession,
  fire,
  heartbeatInput,
  scheduledTasks,
  setSessionModel,
} from './scheduled-tasks.test-support'

const { state, getPathMock, dispatched } = vi.hoisted(() => {
  const payloads: unknown[] = []
  return { state: { userDataDir: '' }, getPathMock: vi.fn(() => ''), dispatched: payloads }
})

getPathMock.mockImplementation(() => state.userDataDir)

vi.mock('electron', () => ({
  app: { getPath: getPathMock, getVersion: () => 'test' },
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
              runId: `run-${String(dispatched.length)}`,
              stateRevision: 1,
            },
          },
        }
      }),
  }
})

const fixture = setUpPiDiscoveryFixture(state)
let release: (() => void) | undefined

afterEach(() => {
  release?.()
  release = undefined
  dispatched.length = 0
})

async function heartbeat(overrides: Parameters<typeof heartbeatInput>[1] = {}) {
  await registerProjects([fixture.project])
  const sessionId = await createIdleSession(fixture.project)
  const outcome = await scheduledTasks({
    operation: 'create',
    input: heartbeatInput(sessionId, overrides),
  })
  if (outcome.effect !== 'created') throw new Error(JSON.stringify(outcome))
  return { sessionId, task: outcome.task }
}

async function readTask(taskId: string) {
  const outcome = await scheduledTasks({ operation: 'read', taskId })
  if (outcome.effect !== 'read') throw new Error(JSON.stringify(outcome))
  return outcome
}

/** Fires once and records the Session Run the firing started. */
async function fireIntoRun(taskId: string, sessionId: string, runId: string) {
  await fire(taskId, Date.now(), 'run-now')
  await recordSessionRun(taskId, sessionId, runId)
}

describe('Every Heartbeat has a way to finish (#388)', () => {
  it('refuses an open-ended Heartbeat, a Launch schedule with Heartbeat settings, and an update that removes the end', async () => {
    await registerProjects([fixture.project])
    const sessionId = await createIdleSession(fixture.project)
    const { heartbeat: _heartbeat, ...openEnded } = heartbeatInput(sessionId)
    expect(await scheduledTasks({ operation: 'create', input: openEnded })).toMatchObject({
      effect: 'rejected',
      code: 'stop_condition_required',
    })
    for (const end of [
      { heartbeat: { indefinite: true } },
      { maxRuns: 2 },
      { endsAt: Date.now() + 86_400_000 },
    ]) {
      expect(
        await scheduledTasks({ operation: 'create', input: { ...openEnded, ...end } }),
      ).toMatchObject({ effect: 'created' })
    }
    expect(
      await scheduledTasks({
        operation: 'create',
        input: {
          name: 'Nightly',
          prompt: 'Triage.',
          enabled: true,
          schedule: { kind: 'interval', everyMinutes: 60 },
          target: {
            kind: 'launch',
            projectPath: fixture.project,
            workspace: 'local',
            archiveFinishedSessions: false,
          },
          heartbeat: { stopWhen: 'never' },
        },
      }),
    ).toMatchObject({ effect: 'rejected', code: 'heartbeat_only' })
    const { task } = await heartbeat()
    expect(
      await scheduledTasks({
        operation: 'update',
        taskId: task.id,
        patch: { heartbeat: { stopWhen: null } },
      }),
    ).toMatchObject({ effect: 'rejected', code: 'stop_condition_required' })
  })
})

describe('Heartbeat Run outcomes and Auto-pause (#388)', () => {
  it('pauses at once on done, with the reason and the agent note', async () => {
    const hooks = await installHeartbeatHooks({ executions: [] })
    release = hooks.release
    const { task, sessionId } = await heartbeat()
    await fireIntoRun(task.id, sessionId, 'run-done')
    const reported = await scheduledTasks({
      operation: 'report-outcome',
      runId: 'run-done',
      outcome: 'done',
      note: 'PR 42 merged',
    })
    expect(reported).toMatchObject({
      effect: 'outcome-recorded',
      run: { outcome: { value: 'done', source: 'reported', note: 'PR 42 merged' } },
      task: {
        enabled: false,
        nextRunAt: null,
        heartbeat: { autoPause: { reason: 'done', message: 'auto-paused: done — PR 42 merged' } },
      },
    })
    expect(
      await scheduledTasks({ operation: 'report-outcome', runId: 'run-unknown', outcome: 'idle' }),
    ).toMatchObject({ effect: 'rejected', code: 'run_not_scheduled' })
  })

  it('keeps a Resume the user gave while the Run that reported done was still running', async () => {
    const hooks = await installHeartbeatHooks({ executions: [] })
    release = hooks.release
    const { task, sessionId } = await heartbeat()
    await fireIntoRun(task.id, sessionId, 'run-done')
    await scheduledTasks({ operation: 'report-outcome', runId: 'run-done', outcome: 'done' })
    expect((await readTask(task.id)).task.enabled).toBe(false)

    await scheduledTasks({ operation: 'update', taskId: task.id, patch: { enabled: true } })
    await settleRunEnd(sessionId, 'run-done', [])
    expect((await readTask(task.id)).task).toMatchObject({
      enabled: true,
      heartbeat: { autoPause: null },
    })
  })

  it('infers idle from read-only tools, acted from any other, and pauses at its threshold', async () => {
    const hooks = await installHeartbeatHooks({ executions: [] })
    release = hooks.release
    const { task, sessionId } = await heartbeat({
      heartbeat: { stopWhen: 'CI is green.', idlePauseAfter: 2 },
    })
    await fireIntoRun(task.id, sessionId, 'run-1')
    await settleRunEnd(sessionId, 'run-1', [{ name: 'read', args: { path: 'README.md' } }])
    expect((await readTask(task.id)).task.heartbeat?.consecutiveIdleRuns).toBe(1)

    await fireIntoRun(task.id, sessionId, 'run-2')
    await settleRunEnd(sessionId, 'run-2', [{ name: 'bash', args: { command: 'gh pr view' } }])
    const acted = await readTask(task.id)
    expect(acted.task.heartbeat?.consecutiveIdleRuns).toBe(0)
    expect(acted.runs[0]?.outcome).toEqual({ value: 'acted', source: 'inferred' })

    await fireIntoRun(task.id, sessionId, 'run-3')
    await scheduledTasks({ operation: 'report-outcome', runId: 'run-3', outcome: 'idle' })
    // A reported outcome wins over what the tools imply.
    await settleRunEnd(sessionId, 'run-3', [{ name: 'edit', args: {} }])
    await fireIntoRun(task.id, sessionId, 'run-4')
    await settleRunEnd(sessionId, 'run-4', [])
    const paused = await readTask(task.id)
    expect(paused.runs[1]?.outcome).toEqual({ value: 'idle', source: 'reported' })
    expect(paused.task).toMatchObject({
      enabled: false,
      heartbeat: {
        consecutiveIdleRuns: 2,
        autoPause: { reason: 'idle', message: 'auto-paused: 2 idle runs' },
      },
    })
  })
})

describe('A Heartbeat own model (#388)', () => {
  it('applies only to its Runs and leaves the Session model alone', async () => {
    const hooks = await installHeartbeatHooks({ executions: [] })
    release = hooks.release
    await registerProjects([fixture.project])
    const sessionId = await createIdleSession(fixture.project)
    await setSessionModel(sessionId)
    const created = await scheduledTasks({
      operation: 'create',
      input: heartbeatInput(sessionId, {
        target: {
          kind: 'heartbeat',
          sessionId,
          modelId: 'test/cheap-model',
          thinkingLevel: 'low',
        },
      }),
    })
    if (created.effect !== 'created') throw new Error(JSON.stringify(created))
    await fireIntoRun(created.task.id, sessionId, 'run-cheap')
    const heartbeatRun = await runProfile(sessionId, 'run-cheap')
    expect(heartbeatRun.model).toBe('test/cheap-model')
    expect(heartbeatRun.thinkingLevel).toBe('low')
    await runSql((sql) =>
      sql`INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
        VALUES ('run-by-hand', ${sessionId}, 'completed',
          ${JSON.stringify({ idempotencyKey: 'typed', callerId: 'gui:local-user' })}, 0, 0)`.pipe(
        Effect.asVoid,
      ),
    )
    const byHand = await runProfile(sessionId, 'run-by-hand')
    expect(byHand.model).toBe('test/test-model')
    expect(byHand.thinkingLevel).toBeUndefined()
  })
})
