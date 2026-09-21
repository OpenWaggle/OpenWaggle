import {
  decodeLocalSessionCommandPayload,
  decodeLocalSessionCommandPayloadForRevision,
} from '@shared/schemas/local-session-protocol'
import { describe, expect, it } from 'vitest'
import { supportedRevisionsForCommand } from '../local-session-client'

describe('native actions wire contract', () => {
  it('requires revision 15 on both the client and Host', () => {
    const payload = decodeLocalSessionCommandPayload({
      contract: 'host-ui-v1',
      request: {
        contractVersion: 1,
        requestId: 'actions',
        channel: 'project-actions:manage',
        args: [
          {
            kind: 'value',
            value: { scope: { projectPath: '/project' }, operation: { type: 'catalog' } },
          },
        ],
      },
    })
    expect(supportedRevisionsForCommand(payload)).toEqual([15])
    expect(() => decodeLocalSessionCommandPayloadForRevision(payload, 14)).toThrow(/revision 15/)
    expect(decodeLocalSessionCommandPayloadForRevision(payload, 15)).toEqual(payload)
  })
})
