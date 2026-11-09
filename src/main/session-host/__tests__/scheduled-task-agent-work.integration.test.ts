import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  registerProjects,
  setUpPiDiscoveryFixture,
} from '../../adapters/pi/__tests__/pi-session-discovery.test-support'
import { agentTaskFixture, dispatched } from './scheduled-task-agent-created.test-support'
import { fire, LOCAL_USER, scheduledTasks } from './scheduled-tasks.test-support'

const { state, getPathMock } = vi.hoisted(() => ({
  state: { userDataDir: '' },
  getPathMock: vi.fn(() => ''),
}))

getPathMock.mockImplementation(() => state.userDataDir)

vi.mock('electron', () => ({
  app: { getPath: getPathMock },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

vi.mock('../scheduled-task-dispatch', async () =>
  (await import('./scheduled-task-agent-created.test-support')).fakeScheduledTaskDispatch(),
)

const fixture = setUpPiDiscoveryFixture(state)
const { agentSession, createLaunch } = agentTaskFixture(fixture)

const AGENT_KEY = /^scheduled-task-run:session-agent:/

function lastKey() {
  return JSON.stringify(dispatched.at(-1)?.payload ?? null).match(/"idempotencyKey":"([^"]+)"/)?.[1]
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

    await fire(task.id, Date.now(), 'run-now')
    expect(lastKey()).not.toMatch(AGENT_KEY)

    const agentEdit = {
      operation: 'update' as const,
      taskId: task.id,
      patch: { prompt: 'Agent’s.' },
    }
    expect(await scheduledTasks(agentEdit, caller)).toMatchObject({ effect: 'updated' })
    await fire(task.id, Date.now(), 'run-now')
    expect(lastKey()).toMatch(AGENT_KEY)

    const personEdit = { operation: 'update' as const, taskId: task.id, patch: { prompt: 'Mine.' } }
    expect(await scheduledTasks(personEdit)).toMatchObject({ effect: 'updated' })
    await fire(task.id, Date.now(), 'run-now')
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
})
