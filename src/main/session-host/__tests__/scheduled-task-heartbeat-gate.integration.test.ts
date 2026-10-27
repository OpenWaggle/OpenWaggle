import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  registerProjects,
  runSql,
  setUpPiDiscoveryFixture,
} from '../../adapters/pi/__tests__/pi-session-discovery.test-support'
import {
  installHeartbeatHooks,
  QUIET,
  recordSessionRun,
  runProfile,
} from './scheduled-task-heartbeat.test-support'
import {
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
const MINUTE = 60_000
let release: (() => void) | undefined

afterEach(() => {
  release?.()
  release = undefined
  dispatched.length = 0
})

async function gatedHeartbeat(overrides: Parameters<typeof heartbeatInput>[1] = {}) {
  await registerProjects([fixture.project])
  const sessionId = await createIdleSession(fixture.project)
  const outcome = await scheduledTasks({
    operation: 'create',
    input: heartbeatInput(sessionId, {
      heartbeat: { stopWhen: 'CI is green.', wakeCheck: { command: 'gh pr checks 42' } },
      ...overrides,
    }),
  })
  if (outcome.effect !== 'created') throw new Error(JSON.stringify(outcome))
  return { sessionId, task: outcome.task }
}

async function readTask(taskId: string) {
  const outcome = await scheduledTasks({ operation: 'read', taskId })
  if (outcome.effect !== 'read') throw new Error(JSON.stringify(outcome))
  return outcome
}

describe('Heartbeat Wake check (#388)', () => {
  it('skips a firing it finds nothing for with no Run, visibly, and auto-pauses after 3', async () => {
    const hooks = await installHeartbeatHooks({ executions: [QUIET, QUIET, QUIET] })
    release = hooks.release
    const { task } = await gatedHeartbeat()
    let now = Date.now()
    for (let firing = 0; firing < 3; firing += 1) {
      await setTaskDue(task.id, now)
      expect(await fire(task.id, now + 1000)).toBe('recorded')
      now += 30 * MINUTE
    }
    expect(hooks.commands).toEqual(['gh pr checks 42', 'gh pr checks 42', 'gh pr checks 42'])
    expect(dispatched).toHaveLength(0)
    const read = await readTask(task.id)
    expect(read.runs).toHaveLength(3)
    expect(read.runs[0]).toMatchObject({
      status: 'skipped',
      reason: 'wake-check-idle',
      wakeCheck: 'idle',
      message: 'The Wake check exited 0 and printed nothing.',
    })
    expect(read.task).toMatchObject({
      enabled: false,
      runCount: 0,
      heartbeat: {
        consecutiveIdleRuns: 3,
        autoPause: { reason: 'idle', message: 'auto-paused: 3 idle runs' },
      },
    })

    const resumed = await scheduledTasks({
      operation: 'update',
      taskId: task.id,
      patch: { enabled: true },
    })
    expect(resumed).toMatchObject({
      effect: 'updated',
      task: { enabled: true, heartbeat: { consecutiveIdleRuns: 0, autoPause: null } },
    })
  })

  it('wakes the Run with what the check printed, and tells the Run its context', async () => {
    const hooks = await installHeartbeatHooks({
      executions: [{ ...QUIET, stdout: 'check "lint" failed\n' }],
    })
    release = hooks.release
    const { task, sessionId } = await gatedHeartbeat({ maxRuns: 10 })
    await setSessionModel(sessionId)
    expect(await fire(task.id, Date.now(), 'run-now')).toBe('recorded')
    expect(dispatched).toHaveLength(1)
    const read = await readTask(task.id)
    expect(read.runs[0]).toMatchObject({
      status: 'started',
      wakeCheck: 'woke',
      message: 'The Wake check: check "lint" failed',
    })
    await recordSessionRun(task.id, sessionId, 'run-woken')
    const profile = await runProfile(sessionId, 'run-woken')
    const identity = profile.runIdentityContext
    expect(identity).toContain('"runCount": 1')
    expect(identity).toContain('"consecutiveIdleRuns": 0')
    expect(identity).toContain('"stopWhen": "CI is green."')
    expect(identity).toContain('"maxRuns": 10')
    expect(identity).toContain('"remainingRuns": 9')
    expect(identity).toContain('"endsAt": null')
    expect(identity).toContain('check \\"lint\\" failed')
    expect(identity).toContain(
      'If stopWhen is met or nothing is left to do, call schedule_update enabled:false and state why; end with outcome done/idle/acted',
    )
  })

  it('reports a failed check, wakes by default, and skips only when the task says so', async () => {
    const timedOut = { ...QUIET, exitCode: null, timedOut: true, stderr: 'still waiting' }
    const hooks = await installHeartbeatHooks({ executions: [timedOut, timedOut] })
    release = hooks.release
    const woke = await gatedHeartbeat()
    await fire(woke.task.id, Date.now(), 'run-now')
    expect(dispatched).toHaveLength(1)
    expect((await readTask(woke.task.id)).runs[0]).toMatchObject({
      status: 'started',
      reason: 'wake-check-failed',
      wakeCheck: 'failed',
      message: 'The Wake check timed out after 30 s: still waiting',
    })

    const skipping = await gatedHeartbeat({
      heartbeat: {
        indefinite: true,
        wakeCheck: { command: 'gh pr checks 42', onFailure: 'skip' },
      },
    })
    await fire(skipping.task.id, Date.now(), 'run-now')
    expect(dispatched).toHaveLength(1)
    const read = await readTask(skipping.task.id)
    expect(read.runs[0]).toMatchObject({ status: 'skipped', reason: 'wake-check-failed' })
    // A failure is never "nothing to do": it does not count toward Auto-pause.
    expect(read.task.heartbeat?.consecutiveIdleRuns).toBe(0)
  })

  it('holds an agent-set check in an Ask for Approval Session until the user approves it', async () => {
    const hooks = await installHeartbeatHooks({ executions: [QUIET], mode: 'ask-for-approval' })
    release = hooks.release
    const { task } = await gatedHeartbeat()
    // As if a Session agent had set it: no approval on record.
    await runSql((sql) =>
      sql`UPDATE scheduled_tasks SET wake_check_approved_command = NULL
        WHERE id = ${task.id}`.pipe(Effect.asVoid),
    )
    const now = Date.now()
    await setTaskDue(task.id, now)
    expect(await fire(task.id, now + 1000)).toBe('waiting')
    expect(hooks.commands).toHaveLength(0)
    expect(dispatched).toHaveLength(0)
    const held = await readTask(task.id)
    expect(held.task.heartbeat?.wakeCheck).toMatchObject({ approval: 'pending' })

    expect(
      await scheduledTasks({
        operation: 'approve-wake-check',
        taskId: task.id,
        command: 'something else',
      }),
    ).toMatchObject({ effect: 'rejected', code: 'wake_check_changed' })
    expect(
      await scheduledTasks({
        operation: 'approve-wake-check',
        taskId: task.id,
        command: 'gh pr checks 42',
      }),
    ).toMatchObject({
      effect: 'updated',
      task: { heartbeat: { wakeCheck: { approval: 'approved' } } },
    })
    expect(await fire(task.id, now + 2 * MINUTE)).toBe('recorded')
    expect(hooks.commands).toEqual(['gh pr checks 42'])
  })
})
