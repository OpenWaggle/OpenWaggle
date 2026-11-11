import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  registerProjects,
  run,
  setUpPiDiscoveryFixture,
} from '../../adapters/pi/__tests__/pi-session-discovery.test-support'
import { scheduledTaskHooks } from '../../application/scheduled-task-hooks'
import { SessionHostLiveness } from '../../application/session-host-liveness'
import { SessionHostEventHub } from '../../application/session-host-event-hub'
import { installSessionHostEventRuntime } from '../session-host-events'
import { launchInput } from './scheduled-task-agent-created.test-support'
import { scheduledTasks, setTaskDue } from './scheduled-tasks.test-support'

interface DispatchState {
  /** Runs started. */
  started: number
  /** Keeps every dispatch waiting until it settles. */
  hold: Promise<void> | null
}

const { state, getPathMock, dispatch } = vi.hoisted(() => {
  const started: DispatchState = { started: 0, hold: null }
  return { state: { userDataDir: '' }, getPathMock: vi.fn(() => ''), dispatch: started }
})

getPathMock.mockImplementation(() => state.userDataDir)

vi.mock('../../desktop-shell/app-paths', () => ({
  appPaths: { userData: () => getPathMock() },
}))

/** Session Control in another Session: a started Run, after `dispatch.hold` settles. */
vi.mock('../scheduled-task-dispatch', async () => {
  const { Effect: EffectModule } = await import('effect')
  return {
    dispatchScheduledTaskCommand: () =>
      EffectModule.promise(async () => {
        await dispatch.hold
        dispatch.started += 1
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
              runId: `run-${String(dispatch.started)}`,
              stateRevision: 1,
            },
          },
        }
      }),
  }
})

/** The first import transforms the whole app runtime, which took over a minute on a busy machine. */
const COLD_RUNTIME_IMPORT_TIMEOUT_MS = 180_000
const SETTLE_TIMEOUT_MS = 15_000

beforeAll(async () => {
  await import('../../runtime')
  await import('../scheduled-task-scheduler')
}, COLD_RUNTIME_IMPORT_TIMEOUT_MS)

const fixture = setUpPiDiscoveryFixture(state)
const releases: (() => void)[] = []

afterEach(() => {
  for (const release of releases.splice(0).toReversed()) release()
  dispatch.started = 0
  dispatch.hold = null
})

/** The Session Host's liveness and event runtime, which the scheduler holds open. */
function installHost() {
  const liveness = new SessionHostLiveness({ idleGracePeriodMs: 60_000, requestShutdown: vi.fn() })
  releases.push(installSessionHostEventRuntime({ eventHub: new SessionHostEventHub(), liveness }))
  releases.push(() => liveness.close())
  return liveness
}

/** Starts the scheduler in the background, as the Host does, until the test ends. */
async function startScheduler() {
  const { runScheduledTaskSchedulerBackground } = await import('../scheduled-task-scheduler')
  const scheduler = await run(
    Effect.forkDaemon(
      Effect.scoped(Effect.zipRight(runScheduledTaskSchedulerBackground, Effect.never)),
    ),
  )
  return () => run(Fiber.interrupt(scheduler))
}

async function createTask(enabled = true) {
  const outcome = await scheduledTasks({
    operation: 'create',
    input: { ...launchInput(fixture.project), enabled },
  })
  if (outcome.effect !== 'created') throw new Error(JSON.stringify(outcome))
  return outcome.task
}

async function runsOf(taskId: string) {
  const outcome = await scheduledTasks({ operation: 'runs', taskId })
  if (outcome.effect !== 'runs-listed') throw new Error(JSON.stringify(outcome))
  return outcome.runs.map((entry) => entry.trigger)
}

const settled = { timeout: SETTLE_TIMEOUT_MS }

describe('the Session Host scheduler', () => {
  it('holds the Host open while a task is enabled, and lets it go when none is or the Host drains', async () => {
    await registerProjects([fixture.project])
    const liveness = installHost()
    const stop = await startScheduler()
    const holds = () => liveness.ownerCount('scheduled-task')

    const task = await createTask()
    await vi.waitFor(() => expect(holds()).toBe(1), settled)
    await scheduledTasks({ operation: 'update', taskId: task.id, patch: { enabled: false } })
    await vi.waitFor(() => expect(holds()).toBe(0), settled)
    await scheduledTasks({ operation: 'update', taskId: task.id, patch: { enabled: true } })
    await vi.waitFor(() => expect(holds()).toBe(1), settled)

    liveness.requestDrain('stop')
    scheduledTaskHooks().tasksChanged()
    await vi.waitFor(() => expect(holds()).toBe(0), settled)
    // Nothing fires once the Host is stopping.
    expect(await scheduledTasks({ operation: 'run-now', taskId: task.id })).toMatchObject({
      effect: 'rejected',
      code: 'scheduler_unavailable',
    })

    await stop()
    expect(dispatch.started).toBe(0)
  })

  it('releases its hold when it stops', async () => {
    await registerProjects([fixture.project])
    const liveness = installHost()
    await createTask()
    const stop = await startScheduler()
    await vi.waitFor(() => expect(liveness.ownerCount('scheduled-task')).toBe(1), settled)

    await stop()

    expect(liveness.ownerCount('scheduled-task')).toBe(0)
    // With the scheduler gone, a Run now has nothing to run it.
    const task = await createTask()
    expect(await scheduledTasks({ operation: 'run-now', taskId: task.id })).toMatchObject({
      code: 'scheduler_unavailable',
    })
  })

  it('fires a due task on its schedule once, and refuses a Run now while that firing runs', async () => {
    await registerProjects([fixture.project])
    installHost()
    const task = await createTask()
    const stop = await startScheduler()
    let release = () => {}
    dispatch.hold = new Promise((resolve) => {
      release = resolve
    })

    await setTaskDue(task.id, Date.now() - 1000)
    scheduledTaskHooks().tasksChanged()
    // The firing waits on Session Control: a Run now meanwhile is refused, and a wake fires nothing.
    await vi.waitFor(
      async () =>
        expect(await scheduledTasks({ operation: 'run-now', taskId: task.id })).toMatchObject({
          code: 'run_already_in_progress',
        }),
      settled,
    )
    scheduledTaskHooks().tasksChanged()
    release()
    await vi.waitFor(() => expect(dispatch.started).toBe(1), settled)

    expect(await scheduledTasks({ operation: 'run-now', taskId: task.id })).toMatchObject({
      effect: 'run-requested',
    })
    await vi.waitFor(() => expect(dispatch.started).toBe(2), settled)
    await stop()
    expect((await runsOf(task.id)).toSorted()).toEqual(['run-now', 'schedule'])
  })
})
