import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import {
  registerProjects,
  runSql,
  setUpPiDiscoveryFixture,
} from '../../adapters/pi/__tests__/pi-session-discovery.test-support'
import { agentTaskFixture } from './scheduled-task-agent-created.test-support'
import { createIdleSession, heartbeatInput, scheduledTasks } from './scheduled-tasks.test-support'

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
const { agentSession } = agentTaskFixture(fixture)

/**
 * The default grant every top-level Session persisted before Scheduled tasks (1.0.0-beta.23).
 * Sessions made then, and Sessions their agents created, still carry exactly this list.
 */
const DEFAULT_BEFORE_SCHEDULED_TASKS = [
  'sessions:discover',
  'sessions:read',
  'sessions:create',
  'sessions:start',
  'sessions:spawn',
  'sessions:message',
  'sessions:steer',
  'sessions:interrupt',
  'sessions:queue',
  'sessions:report',
  'sessions:organize',
  'sessions:export',
  'delegations:read',
  'delegations:contribute',
  'delegations:review',
  'access:profiles',
] as const

function persistedProfile(sessionId: string) {
  return runSql((sql) =>
    sql<{ readonly profile_json: string }>`SELECT profile_json FROM session_execution_profiles
      WHERE session_id = ${sessionId}`.pipe(Effect.map((rows) => rows[0]?.profile_json)),
  )
}

describe('the schedule capabilities of a top-level Session agent', () => {
  it('lets the agent of a Session made before Scheduled tasks create its own Heartbeat', async () => {
    await registerProjects([fixture.project])
    const { sessionId, caller } = await agentSession('yolo', {
      persistedCapabilities: DEFAULT_BEFORE_SCHEDULED_TASKS,
    })

    expect(caller.profileAuthority?.capabilities).toEqual(
      expect.arrayContaining(['schedules:read', 'schedules:manage']),
    )
    const created = await scheduledTasks(
      { operation: 'create', input: heartbeatInput(sessionId) },
      caller,
    )
    expect(created).toMatchObject({
      effect: 'created',
      task: { kind: 'heartbeat', creator: { kind: 'session-agent', sessionId } },
    })
    expect(await scheduledTasks({ operation: 'list', sessionId }, caller)).toMatchObject({
      effect: 'listed',
      tasks: [{ target: { kind: 'heartbeat', sessionId } }],
    })
  })

  it('keeps a Session whose grant really lacks them from scheduling, and says what is missing', async () => {
    await registerProjects([fixture.project])
    const { sessionId, caller } = await agentSession('yolo', {
      persistedCapabilities: ['sessions:read', 'sessions:report'],
    })

    expect(
      await scheduledTasks({ operation: 'create', input: heartbeatInput(sessionId) }, caller),
    ).toMatchObject({
      effect: 'rejected',
      code: 'capability_denied',
      message: 'This caller lacks schedules:manage.',
    })
  })

  it('persists no capability snapshot for a Session the desktop creates', async () => {
    const sessionId = await createIdleSession(fixture.project)

    expect(JSON.parse((await persistedProfile(sessionId)) ?? '{}')).not.toHaveProperty(
      'sessionCapabilities',
    )
  })
})
