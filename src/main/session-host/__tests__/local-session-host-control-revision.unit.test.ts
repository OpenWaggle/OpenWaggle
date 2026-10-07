import {
  decodeLocalSessionCommandPayload,
  decodeLocalSessionCommandPayloadForRevision,
} from '@shared/schemas/local-session-protocol'
import { describe, expect, it } from 'vitest'
import { supportedRevisionsForCommand } from '../local-session-client'
import { decodeLocalSessionCommandResponse } from '../local-session-client-response'
import { negotiateLocalSessionProtocol } from '../local-session-negotiation'

const stopPayload = {
  contract: 'local-host-v1',
  request: { contractVersion: 1, operation: 'stop' },
}

describe('Session Host stop wire contract', () => {
  it('requires a revision-nineteen Host on both the client and the Host', () => {
    const payload = decodeLocalSessionCommandPayload(stopPayload)

    expect(supportedRevisionsForCommand(payload)).toEqual([22])
    expect(() => decodeLocalSessionCommandPayloadForRevision(payload, 18)).toThrow(/revision 19/)
    expect(decodeLocalSessionCommandPayloadForRevision(payload, 19)).toEqual(payload)
  })

  it('rejects unknown stop operations and fields', () => {
    expect(() =>
      decodeLocalSessionCommandPayload({
        contract: 'local-host-v1',
        request: { contractVersion: 1, operation: 'kill' },
      }),
    ).toThrow()
    expect(() =>
      decodeLocalSessionCommandPayload({
        contract: 'local-host-v1',
        request: { contractVersion: 1, operation: 'stop', force: true },
      }),
    ).toThrow()
  })

  it('decodes the stop response exactly', () => {
    const response = {
      contractVersion: 1,
      operation: 'stop',
      hostInstanceId: 'host-1',
      blockingRuns: 2,
      blockingActions: 0,
    }
    expect(
      decodeLocalSessionCommandResponse(
        { kind: 'response', requestId: 'stop', payload: { contract: 'local-host-v1', response } },
        'stop',
      ),
    ).toEqual({ contract: 'local-host-v1', response })
    const uncounted = { ...response, blockingRuns: null }
    expect(
      decodeLocalSessionCommandResponse(
        {
          kind: 'response',
          requestId: 'stop',
          payload: { contract: 'local-host-v1', response: uncounted },
        },
        'stop',
      ),
    ).toEqual({ contract: 'local-host-v1', response: uncounted })
    expect(() =>
      decodeLocalSessionCommandResponse(
        {
          kind: 'response',
          requestId: 'stop',
          payload: { contract: 'local-host-v1', response: { ...response, blockingRuns: -1 } },
        },
        'stop',
      ),
    ).toThrow()
  })

  it.each(['gui', 'cli', 'mcp', 'internal'] as const)(
    'rejects a revision-18 %s client so an older Host is replaced before stop can be sent',
    (clientKind) => {
      expect(
        negotiateLocalSessionProtocol(
          {
            protocol: 'openwaggle-local-session',
            supportedRevisions: [18],
            clientKind,
            clientVersion: 'previous',
          },
          'host-current',
        ),
      ).toMatchObject({ accepted: false, supportedRevisions: [22] })
    },
  )
})
