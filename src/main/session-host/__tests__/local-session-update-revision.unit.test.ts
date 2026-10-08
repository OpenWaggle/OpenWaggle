import {
  decodeLocalSessionCommandPayload,
  decodeLocalSessionCommandPayloadForRevision,
} from '@shared/schemas/local-session-protocol'
import {
  LOCAL_SESSION_CURRENT_REVISION,
  LOCAL_SESSION_PROTOCOL_NAME,
} from '@shared/types/local-session-protocol'
import { describe, expect, it } from 'vitest'
import { supportedRevisionsForCommand } from '../local-session-client'
import { decodeLocalSessionCommandResponse } from '../local-session-client-response'
import { negotiateLocalSessionProtocol } from '../local-session-negotiation'

describe('update channel wire contract', () => {
  it.each([
    { contractVersion: 1, operation: 'get-channel' },
    { contractVersion: 1, operation: 'set-channel', channel: 'stable' },
  ])('retains revision-fourteen support for $operation', (request) => {
    const payload = decodeLocalSessionCommandPayload({ contract: 'local-update-v1', request })
    expect(supportedRevisionsForCommand(payload)).toEqual([23])
    expect(() => decodeLocalSessionCommandPayloadForRevision(payload, 13)).toThrow(/revision 14/)
    expect(decodeLocalSessionCommandPayloadForRevision(payload, 14)).toEqual(payload)
    expect(decodeLocalSessionCommandPayloadForRevision(payload, 15)).toEqual(payload)
    expect(decodeLocalSessionCommandPayloadForRevision(payload, 16)).toEqual(payload)
    expect(decodeLocalSessionCommandPayloadForRevision(payload, 17)).toEqual(payload)
  })

  it('decodes the revision-fourteen update response unchanged', () => {
    expect(
      decodeLocalSessionCommandResponse(
        {
          kind: 'response',
          requestId: 'update-channel',
          payload: {
            contract: 'local-update-v1',
            response: { contractVersion: 1, updateChannel: 'stable' },
          },
        },
        'update-channel',
      ),
    ).toEqual({
      contract: 'local-update-v1',
      response: { contractVersion: 1, updateChannel: 'stable' },
    })
  })

  // `openwaggle update` reads the channel before anything else: offering only revision 14 failed
  // at every Host since revision 17, which accepts only its current revision.
  it.each(['cli', 'gui'] as const)(
    'negotiates the current revision for a %s update command',
    (clientKind) => {
      const payload = decodeLocalSessionCommandPayload({
        contract: 'local-update-v1',
        request: { contractVersion: 1, operation: 'get-channel' },
      })
      const result = negotiateLocalSessionProtocol(
        {
          protocol: LOCAL_SESSION_PROTOCOL_NAME,
          supportedRevisions: supportedRevisionsForCommand(payload) ?? [],
          clientKind,
          clientVersion: 'test',
        },
        'host',
      )
      expect(result).toMatchObject({ accepted: true, revision: LOCAL_SESSION_CURRENT_REVISION })
    },
  )
})
