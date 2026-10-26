import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import { describe, expect, it, vi } from 'vitest'
import { run, setUpPiDiscoveryFixture } from './pi-session-discovery.test-support'

/**
 * A view can still ask about a Session the Host just removed, as one whose Pi file was deleted.
 * That is an expected answer, that the Session is not found, not a failure of the query.
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

describe('A query about a Session that was removed', () => {
  it.each<['requests-list' | 'queue-list']>([['requests-list'], ['queue-list']])(
    'answers that the Session is not found for %s',
    async (operation) => {
      const { dispatchLocalSessionCommand } = await import(
        '../../../application/local-session-command-dispatcher'
      )

      const result = await run(
        dispatchLocalSessionCommand({
          caller: { callerId: 'gui:local-user', workingDirectory: fixture.project },
          payload: {
            contract: 'session-query-v2',
            request: {
              contractVersion: SESSION_QUERY_CONTRACT_VERSION,
              requestId: `removed-session-${operation}`,
              query: { operation, sessionId: 'session-that-was-removed' },
            },
          },
        }),
      )

      expect(result).toMatchObject({
        contract: 'session-query-v2',
        response: { outcome: { operation, error: { code: 'session_not_found' } } },
      })
    },
  )

  it('answers every action on an unknown ID with one not-found shape (#351)', async () => {
    const { dispatchLocalSessionCommand } = await import(
      '../../../application/local-session-command-dispatcher'
    )
    const caller = { callerId: 'gui:local-user', workingDirectory: fixture.project }
    const unknown = 'session-that-never-existed'

    const followUp = await run(
      dispatchLocalSessionCommand({
        caller,
        payload: {
          contract: 'session-control-v2',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'unknown-follow-up',
            idempotencyKey: 'unknown-follow-up',
            command: {
              operation: 'follow-up',
              sessionId: unknown,
              input: { text: 'hi', attachmentIds: [] },
            },
          },
        },
      }),
    )
    const delegation = await run(
      dispatchLocalSessionCommand({
        caller,
        payload: {
          contract: 'session-query-v2',
          request: {
            contractVersion: SESSION_QUERY_CONTRACT_VERSION,
            requestId: 'unknown-delegation',
            query: { operation: 'delegations-read', delegationId: 'delegation-that-never-existed' },
          },
        },
      }),
    )

    expect(followUp).toMatchObject({
      contract: 'session-control-v2',
      response: {
        outcome: { operation: 'follow-up', effect: 'rejected', code: 'session_not_found' },
      },
    })
    expect(delegation).toMatchObject({
      response: {
        outcome: { operation: 'delegations-read', error: { code: 'delegation_not_found' } },
      },
    })
  })
})
