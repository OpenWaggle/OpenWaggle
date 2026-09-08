import {
  decodeLocalSessionCommandPayload,
  decodeLocalSessionCommandPayloadForRevision,
} from '@shared/schemas/local-session-protocol'
import { describe, expect, it } from 'vitest'
import { supportedRevisionsForCommand } from '../local-session-client'

describe('Local Session steering receipt revision', () => {
  it.each(['steer', 'promote'] as const)(
    'requires receipt-aware revision eight for %s',
    (operation) => {
      const payload = decodeLocalSessionCommandPayload({
        contract: 'session-control-v2',
        request: {
          contractVersion: 2,
          requestId: 'request-receipt',
          idempotencyKey: 'receipt',
          command: {
            operation,
            sessionId: 'session',
            expectedRunId: 'run',
            ...(operation === 'promote'
              ? { followUpId: 'follow-up' }
              : { input: { text: 'continue', attachmentIds: [] } }),
          },
        },
      })
      expect(supportedRevisionsForCommand(payload)).toEqual([9, 8])
      expect(() => decodeLocalSessionCommandPayloadForRevision(payload, 7)).toThrow(/revision 8/)
      expect(decodeLocalSessionCommandPayloadForRevision(payload, 8)).toEqual(payload)
    },
  )
})
