import {
  decodeLocalSessionCommandPayload,
  decodeLocalSessionCommandPayloadForRevision,
} from '@shared/schemas/local-session-protocol'
import { describe, expect, it } from 'vitest'
import { supportedRevisionsForCommand } from '../local-session-client'

describe('Local Session workspace authorization revision', () => {
  it.each(['workspace-files:authorize-project', 'inline-visualization:prepare-source'])(
    'keeps revision nine as the minimum for %s',
    (channel) => {
      const payload = decodeLocalSessionCommandPayload({
        contract: 'host-ui-v1',
        request: {
          contractVersion: 1,
          requestId: 'workspace-authorization',
          channel,
          args: [{ kind: 'value', value: '/project' }],
        },
      })

      expect(supportedRevisionsForCommand(payload)).toEqual([10, 9])
      expect(() => decodeLocalSessionCommandPayloadForRevision(payload, 8)).toThrow(/revision 9/)
      expect(decodeLocalSessionCommandPayloadForRevision(payload, 9)).toEqual(payload)
    },
  )
})
