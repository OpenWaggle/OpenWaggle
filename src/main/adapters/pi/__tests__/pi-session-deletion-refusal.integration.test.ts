import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import {
  createPiCliSession,
  discover,
  registerProjects,
  runSql,
  setUpPiDiscoveryFixture,
} from './pi-session-discovery.test-support'

/**
 * Asking whether a Session can be deleted changes nothing, not even for other work on the one
 * SQLite connection: the trial delete it rolls back must never roll back another fiber's writes.
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
const ROUNDS = 40
const WRITES = 200

describe('Checking whether a discovered Session can be deleted', () => {
  it('keeps the writes other work makes while it checks', async () => {
    await registerProjects([fixture.project])
    createPiCliSession(fixture.project, 'Checked')
    createPiCliSession(fixture.project, 'Written meanwhile')
    const [checked, written] = await discover()
    if (!checked || !written) throw new Error('Discovery listed fewer Sessions than expected.')
    const { piSessionDeletionRefusal, piSessionDeletionRefusalWithSql } = await import(
      '../../../store/session-details/pi-session-discovery-store'
    )

    // Checks and writes take turns on the one connection, as the Host's fibers do; yielding after
    // every step lets a write land between any two statements of a check.
    await runSql((sql) =>
      Effect.all(
        [
          Effect.forEach(
            Array.from({ length: ROUNDS }, (_, round) => round),
            () => piSessionDeletionRefusalWithSql(sql, SessionId(checked)),
            { discard: true },
          ),
          Effect.forEach(
            Array.from({ length: WRITES }, (_, round) => round),
            (round) => sql`
              INSERT INTO pi_session_discovery_creates (idempotency_key, created_at)
              VALUES (${`written-${String(round)}`}, ${round})
            `,
            { discard: true },
          ),
        ],
        { concurrency: 'unbounded', discard: true },
      ).pipe(Effect.withMaxOpsBeforeYield(32)),
    )
    const rows = await runSql(
      (sql) => sql<{ readonly key: string }>`
        SELECT idempotency_key AS key FROM pi_session_discovery_creates WHERE idempotency_key LIKE ${'written-%'}
      `,
    )

    // Every write landed, none was rolled back with a trial delete.
    expect(rows).toHaveLength(WRITES)
    expect(await piSessionDeletionRefusal(SessionId(checked))).toBeUndefined()
  })
})
