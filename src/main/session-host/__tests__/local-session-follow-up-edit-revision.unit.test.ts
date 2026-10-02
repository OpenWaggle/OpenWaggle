import {
  decodeLocalSessionCommandPayload,
  decodeLocalSessionCommandPayloadForRevision,
} from '@shared/schemas/local-session-protocol'
import { describe, expect, it } from 'vitest'
import { supportedRevisionsForCommand } from '../local-session-client'
import { negotiateLocalSessionProtocol } from '../local-session-negotiation'

const editCommands = [
  { operation: 'queue-edit-begin', sessionId: 'session-1', followUpId: 'follow-up-1' },
  {
    operation: 'queue-edit-save',
    sessionId: 'session-1',
    followUpId: 'follow-up-1',
    holdId: 'hold-1',
    expectedQueueRevision: 3,
    input: { text: 'Edited', attachmentIds: [] },
  },
  {
    operation: 'queue-edit-cancel',
    sessionId: 'session-1',
    followUpId: 'follow-up-1',
    holdId: 'hold-1',
  },
] as const

describe('Follow-up edit wire contract', () => {
  it.each(editCommands)('requires a revision-21 Host for $operation', (command) => {
    const payload = decodeLocalSessionCommandPayload({
      contract: 'session-control-v2',
      request: { contractVersion: 2, requestId: 'r', idempotencyKey: 'k', command },
    })
    expect(supportedRevisionsForCommand(payload)).toEqual([21])
    expect(() => decodeLocalSessionCommandPayloadForRevision(payload, 20)).toThrow(/revision 21/)
    expect(decodeLocalSessionCommandPayloadForRevision(payload, 21)).toEqual(payload)
  })

  it('requires a revision-21 Host to renew a hold', () => {
    const payload = decodeLocalSessionCommandPayload({
      contract: 'local-ui-v1',
      request: {
        requestId: 'r',
        command: {
          operation: 'renew-follow-up-edit-hold',
          sessionId: 'session-1',
          followUpId: 'follow-up-1',
          holdId: 'hold-1',
        },
      },
    })
    expect(supportedRevisionsForCommand(payload)).toEqual([21])
    expect(() => decodeLocalSessionCommandPayloadForRevision(payload, 20)).toThrow(/revision 21/)
  })

  it('advertises the Follow-up edit capability and asks a revision-20 desktop to upgrade', () => {
    expect(
      negotiateLocalSessionProtocol(
        {
          protocol: 'openwaggle-local-session',
          supportedRevisions: [21],
          clientKind: 'gui',
          clientVersion: 'current',
        },
        'host-current',
      ),
    ).toMatchObject({
      accepted: true,
      capabilities: expect.arrayContaining(['sessions:follow-up-edit-v1']),
    })
    expect(
      negotiateLocalSessionProtocol(
        {
          protocol: 'openwaggle-local-session',
          supportedRevisions: [20],
          clientKind: 'gui',
          clientVersion: 'previous',
        },
        'host-current',
      ),
    ).toMatchObject({ accepted: false, supportedRevisions: [21] })
  })
})
