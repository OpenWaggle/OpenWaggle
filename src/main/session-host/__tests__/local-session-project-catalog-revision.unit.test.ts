import {
  decodeLocalSessionCommandPayload,
  decodeLocalSessionCommandPayloadForRevision,
} from '@shared/schemas/local-session-protocol'
import { describe, expect, it } from 'vitest'
import { supportedRevisionsForCommand } from '../local-session-client'

describe('Local Session project catalog revision', () => {
  it('requires a revision-twelve Host for indexed Settings project discovery', () => {
    const payload = decodeLocalSessionCommandPayload({
      contract: 'host-ui-v1',
      request: {
        contractVersion: 1,
        requestId: 'project-catalog',
        channel: 'sessions:list-projects',
        args: [{ kind: 'value', value: 100 }],
      },
    })

    expect(supportedRevisionsForCommand(payload)).toEqual([12])
    expect(() => decodeLocalSessionCommandPayloadForRevision(payload, 11)).toThrow(/revision 12/)
    expect(decodeLocalSessionCommandPayloadForRevision(payload, 12)).toEqual(payload)
  })
})
