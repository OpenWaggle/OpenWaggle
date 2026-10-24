import { randomUUID } from 'node:crypto'
import { SESSION_LIFECYCLE_CONTRACT_VERSION } from '@shared/types/session-lifecycle'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import {
  createPiCliSession,
  lifecycleCreate,
  registerProjects,
  run,
  runSql,
  setUpPiDiscoveryFixture,
} from './pi-session-discovery.test-support'

/**
 * Discovery's lifecycle creates carry keys under its own prefix, and the Host start removes the
 * empty Sessions an interrupted pass left (ADR 0051). Only creates discovery itself recorded
 * count: anyone can choose an idempotency key, as `openwaggle hive create
 * --idempotency-key` does.
 */

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

const fixture = setUpPiDiscoveryFixture(state)

/** A create sent to the Session Host, as `openwaggle hive create` sends one. */
async function externalCreate(idempotencyKey: string) {
  const { dispatchLocalSessionCommand } = await import(
    '../../../application/local-session-command-dispatcher'
  )
  const result = await run(
    dispatchLocalSessionCommand({
      caller: { callerId: 'gui:local-user', workingDirectory: fixture.project },
      payload: {
        contract: 'session-lifecycle-v2',
        request: {
          contractVersion: SESSION_LIFECYCLE_CONTRACT_VERSION,
          requestId: randomUUID(),
          idempotencyKey,
          command: {
            operation: 'create',
            projectPath: fixture.project,
            title: 'Made by hand',
            workspace: { mode: 'local' },
          },
        },
      },
    }),
  )
  if (result.contract !== 'session-lifecycle-v2') throw new Error('Not a lifecycle response.')
  return result.response.outcome
}

async function recordedCreates() {
  return runSql(
    (sql) => sql<{ readonly key: string }>`
      SELECT idempotency_key AS key FROM pi_session_discovery_creates
    `,
  )
}

async function sessionIds() {
  const rows = await runSql((sql) => sql<{ readonly id: string }>`SELECT id FROM sessions`)
  return rows.map((row) => row.id)
}

describe("Pi session discovery's lifecycle keys", () => {
  it('refuses a create from anyone else that uses the key prefix discovery reserves', async () => {
    await registerProjects([fixture.project])

    const outcome = await externalCreate('pi-session-discovery:chosen-by-hand')

    expect(outcome).toMatchObject({ effect: 'rejected', code: 'reserved_idempotency_key' })
    expect(await sessionIds()).toEqual([])
  })

  it('leaves an empty Session that discovery did not create when the Host starts', async () => {
    await registerProjects([fixture.project])
    const outcome = await externalCreate(`by-hand-${randomUUID()}`)
    if (outcome.effect !== 'created-root') throw new Error('The Session was not created.')
    // A create an older Host admitted under the prefix, which discovery never recorded.
    await runSql(
      (sql) => sql`
        UPDATE session_operations SET idempotency_key = ${'pi-session-discovery:old'}
        WHERE operation = ${'create'}
      `,
    )
    const { removeUnattachedDiscoveredSessions } = await import(
      '../../../application/pi-session-discovery'
    )

    await run(removeUnattachedDiscoveredSessions())

    expect(await sessionIds()).toEqual([outcome.sessionId])
  })

  it('keeps the record of a create a Host stop interrupted, so its next start cleans up', async () => {
    await registerProjects([fixture.project])
    createPiCliSession(fixture.project, 'Interrupted attach')
    const { PiSessionDiscoveryRepository } = await import('../../../ports/pi-session-discovery')
    const { discoverPiSessions, removeUnattachedDiscoveredSessions } = await import(
      '../../../application/pi-session-discovery'
    )
    const createSession = await lifecycleCreate()

    // The Host stops while the pass attaches the file to the Session it just created.
    await run(
      Effect.gen(function* () {
        const repository = yield* PiSessionDiscoveryRepository
        return yield* discoverPiSessions({ createSession }).pipe(
          Effect.provideService(PiSessionDiscoveryRepository, {
            ...repository,
            adoptDiscovered: () => Effect.interrupt,
          }),
        )
      }),
    )
    // A stop may end the process before the Session it created is removed, so the record stays.
    expect(await recordedCreates()).toHaveLength(1)

    await run(removeUnattachedDiscoveredSessions())

    expect(await sessionIds()).toEqual([])
    expect(await recordedCreates()).toEqual([])
  })
})
