import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  registerProjects,
  run,
  setUpPiDiscoveryFixture,
} from '../../adapters/pi/__tests__/pi-session-discovery.test-support'
import { agentTaskFixture, dispatched } from './scheduled-task-agent-created.test-support'
import { fire, LOCAL_USER, scheduledTasks, setTaskDue } from './scheduled-tasks.test-support'

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

const AGENT_KEY = /^scheduled-task-run:session-agent:/

function lastKey() {
  return JSON.stringify(dispatched.at(-1)?.payload ?? null).match(/"idempotencyKey":"([^"]+)"/)?.[1]
}

/** Fires the task as its schedule would, at a time it is due. */
async function fireWhenDue(taskId: string) {
  const at = Date.now() - 1000
  await setTaskDue(taskId, at)
  expect(await fire(taskId, at + 500)).toBe('recorded')
}

let releaseHooks: (() => void) | null = null

afterEach(() => {
  releaseHooks?.()
  releaseHooks = null
})

/*
 * The person's Scheduled task runs as them, so its firings are the person's, until an agent
 * writes its work or asks for a Run now: those are an agent's, held to the Worker limits
 * (ADR 0030, amended 2026-11-09), or an agent could launch uncounted roots through them.
 */
describe('a Scheduled task whose work an agent wrote', () => {
  it('fires as an agent’s work once a Session agent changes the person’s task, until they do', async () => {
    await registerProjects([fixture.project])
    const { caller } = await agentSession('yolo')
    const task = await createLaunch(LOCAL_USER)

    await fireWhenDue(task.id)
    expect(lastKey()).not.toMatch(AGENT_KEY)

    const agentEdit = {
      operation: 'update' as const,
      taskId: task.id,
      patch: { prompt: 'Agent’s.' },
    }
    expect(await scheduledTasks(agentEdit, caller)).toMatchObject({ effect: 'updated' })
    await fireWhenDue(task.id)
    expect(lastKey()).toMatch(AGENT_KEY)
    // A Run now the person chooses is theirs, whoever wrote the work.
    await fire(task.id, Date.now(), 'run-now')
    expect(lastKey()).not.toMatch(AGENT_KEY)

    const personEdit = { operation: 'update' as const, taskId: task.id, patch: { prompt: 'Mine.' } }
    expect(await scheduledTasks(personEdit)).toMatchObject({ effect: 'updated' })
    await fireWhenDue(task.id)
    expect(lastKey()).not.toMatch(AGENT_KEY)
  })

  it('fires a Run now as whoever asked for it', async () => {
    const requests: boolean[] = []
    const { installScheduledTaskHooks } = await import('../../application/scheduled-task-hooks')
    releaseHooks = installScheduledTaskHooks({
      requestRunNow: (_taskId, requestedByAgent) =>
        Effect.sync(() => {
          requests.push(requestedByAgent)
          return 'accepted' as const
        }),
    })
    await registerProjects([fixture.project])
    const { caller } = await agentSession('yolo')
    const task = await createLaunch(LOCAL_USER)

    await scheduledTasks({ operation: 'run-now', taskId: task.id }, caller)
    await scheduledTasks({ operation: 'run-now', taskId: task.id })
    expect(requests).toEqual([true, false])

    await fire(task.id, Date.now(), 'run-now', true)
    expect(lastKey()).toMatch(AGENT_KEY)
  })

  it('fires an agent’s Run now through the scheduler as an agent’s work', async () => {
    const { runScheduledTaskSchedulerBackground } = await import('../scheduled-task-scheduler')
    await registerProjects([fixture.project])
    const { caller } = await agentSession('yolo')
    const task = await createLaunch(LOCAL_USER)
    // Held open until interrupted: the scheduler runs in its scope's background.
    const scheduler = await run(
      Effect.forkDaemon(
        Effect.scoped(Effect.zipRight(runScheduledTaskSchedulerBackground, Effect.never)),
      ),
    )
    try {
      const before = dispatched.length
      await vi.waitFor(async () => {
        expect(
          await scheduledTasks({ operation: 'run-now', taskId: task.id }, caller),
        ).toMatchObject({ effect: 'run-requested' })
      })
      await vi.waitFor(() => expect(dispatched.length).toBeGreaterThan(before), { timeout: 10_000 })
      expect(lastKey()).toMatch(AGENT_KEY)
    } finally {
      await run(Fiber.interrupt(scheduler))
    }
  })
})
