import {
  decodeLocalSessionCommandPayload,
  decodeLocalSessionCommandPayloadForRevision,
} from '@shared/schemas/local-session-protocol'
import { describe, expect, it } from 'vitest'
import { supportedRevisionsForCommand } from '../local-session-client'
import { decodeLocalSessionCommandResponse } from '../local-session-client-response'

describe('update channel wire contract', () => {
  it.each([
    { contractVersion: 1, operation: 'get-channel' },
    { contractVersion: 1, operation: 'set-channel', channel: 'stable' },
  ])('retains revision-fourteen support for $operation', (request) => {
    const payload = decodeLocalSessionCommandPayload({ contract: 'local-update-v1', request })
    expect(supportedRevisionsForCommand(payload)).toEqual([15, 14])
    expect(() => decodeLocalSessionCommandPayloadForRevision(payload, 13)).toThrow(/revision 14/)
    expect(decodeLocalSessionCommandPayloadForRevision(payload, 14)).toEqual(payload)
    expect(decodeLocalSessionCommandPayloadForRevision(payload, 15)).toEqual(payload)
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
})
