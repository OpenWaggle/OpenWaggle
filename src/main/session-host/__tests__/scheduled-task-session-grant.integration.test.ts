import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import {
  registerProjects,
  runSql,
  setUpPiDiscoveryFixture,
} from '../../adapters/pi/__tests__/pi-session-discovery.test-support'
import {
  restoreSessionCapabilityGrants,
  SESSION_CAPABILITY_GRANTS_RESTORED_KEY,
} from '../../adapters/sqlite-legacy-session-capability-migration'
import { DEFAULT_BEFORE_SCHEDULED_TASKS } from '../../domain/session-control/session-capability-restriction'
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

/** The Host's start-time capability restore, run against the fixture database. */
function restoreGrants() {
  return runSql((sql) =>
    restoreSessionCapabilityGrants().pipe(Effect.provideService(SqlClient.SqlClient, sql)),
  )
}

function persistedProfile(sessionId: string) {
  return runSql((sql) =>
    sql<{ readonly profile_json: string }>`SELECT profile_json FROM session_execution_profiles
      WHERE session_id = ${sessionId}`.pipe(Effect.map((rows) => rows[0]?.profile_json)),
  )
}

describe('the schedule capabilities of a top-level Session agent', () => {
  it('lets the agent of a Session made before Scheduled tasks create its own Heartbeat once the Host restores its grant', async () => {
    await registerProjects([fixture.project])
    const { sessionId, caller } = await agentSession('yolo', {
      persistedCapabilities: DEFAULT_BEFORE_SCHEDULED_TASKS,
      beforeRun: async (id) => {
        // Written before Scheduled tasks: earlier than migration 70 ran.
        await runSql(
          (sql) =>
            sql`UPDATE session_execution_profiles SET created_at = 0 WHERE session_id = ${id}`,
        )
        expect(await restoreGrants()).toBe(1)
      },
    })

    expect(JSON.parse((await persistedProfile(sessionId)) ?? '{}')).not.toHaveProperty(
      'sessionCapabilities',
    )
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

  it('keeps a Session that kept the older grant on purpose from scheduling', async () => {
    await registerProjects([fixture.project])
    // Written after Scheduled tasks, with no Session it inherited the older grant from.
    const { sessionId, caller } = await agentSession('yolo', {
      persistedCapabilities: DEFAULT_BEFORE_SCHEDULED_TASKS,
      beforeRun: async () => {
        await runSql(
          (sql) =>
            sql`DELETE FROM settings_store WHERE key = ${SESSION_CAPABILITY_GRANTS_RESTORED_KEY}`,
        )
        expect(await restoreGrants()).toBe(0)
      },
    })

    expect(
      await scheduledTasks({ operation: 'create', input: heartbeatInput(sessionId) }, caller),
    ).toMatchObject({
      effect: 'rejected',
      code: 'capability_denied',
      message: 'This caller lacks schedules:manage.',
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
