import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import { describe, expect, it, vi } from 'vitest'
import {
  continuePiCliSession,
  createPiCliSession,
  discoverOne,
  registerProjects,
  run,
  setUpPiDiscoveryFixture,
} from './pi-session-discovery.test-support'

/**
 * The Sessions tool and `openwaggle sessions` read a discovered Pi session as its file is now
 * (ADR 0048), like the sidebar does, instead of an empty or stale projection.
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

async function readItems(sessionId: string) {
  const { dispatchSessionQuery } = await import(
    '../../../application/local-session-query-dispatcher'
  )
  const result = await run(
    dispatchSessionQuery(
      { callerId: 'gui:local-user', workingDirectory: fixture.project },
      {
        contract: 'session-query-v2',
        request: {
          contractVersion: SESSION_QUERY_CONTRACT_VERSION,
          requestId: 'read-items',
          query: { operation: 'items', sessionId, limit: 50 },
        },
      },
    ),
  )
  if (result.contract !== 'session-query-v2') throw new Error('Unexpected query contract.')
  const outcome = result.response.outcome
  if (outcome.operation !== 'items' || !('items' in outcome)) {
    throw new Error('Unexpected query outcome.')
  }
  return outcome.items
}

describe('Session queries on a discovered Pi session', () => {
  it('reads the transcript the pi CLI wrote, including what it added since', async () => {
    await registerProjects([fixture.project])
    const cli = createPiCliSession(fixture.project, 'Read me through the Sessions tool')
    const sessionId = await discoverOne()

    expect((await readItems(sessionId)).filter((item) => item.role !== null)).toHaveLength(2)

    continuePiCliSession(cli.file, 'And this too')
    expect((await readItems(sessionId)).filter((item) => item.role !== null)).toHaveLength(4)
  })
})
