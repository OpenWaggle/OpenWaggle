import { describe, expect, it } from 'vitest'
import {
  decodeLocalSessionCommandPayload,
  decodeLocalSessionCommandPayloadForRevision,
} from '../../../shared/schemas/local-session-protocol'
import { HOST_UI_REVISION_25_REQUIRED_CHANNELS } from '../../../shared/types/host-ui-protocol'
import {
  LOCAL_SESSION_REVISION_24_CAPABILITIES,
  LOCAL_SESSION_REVISION_25_CAPABILITIES,
} from '../../../shared/types/local-session-protocol-revisions'
import { supportedRevisionsForCommand } from '../local-session-client'

function hostUiCommand(channel: string) {
  return decodeLocalSessionCommandPayload({
    contract: 'host-ui-v1',
    request: { contractVersion: 1, requestId: `request-${channel}`, channel, args: [] },
  })
}

describe('Local Session Archived items protocol revision', () => {
  it('ships the Settings > Archived items channels', () => {
    expect(HOST_UI_REVISION_25_REQUIRED_CHANNELS).toEqual([
      'sessions:query-archived-items',
      'sessions:list-archived-item-refs',
      'sessions:set-archived-items',
      'sessions:delete-archived-sessions',
    ])
  })

  it.each([...HOST_UI_REVISION_25_REQUIRED_CHANNELS])(
    'sends %s only to a revision-25 Host',
    (channel) => {
      const command = hostUiCommand(channel)
      expect(supportedRevisionsForCommand(command)).toEqual([29])
      expect(() => decodeLocalSessionCommandPayloadForRevision(command, 24)).toThrow(/revision 25/)
      expect(decodeLocalSessionCommandPayloadForRevision(command, 25)).toEqual(command)
    },
  )

  it('advertises the Archived items capability from revision 25', () => {
    expect(LOCAL_SESSION_REVISION_24_CAPABILITIES).not.toContain('host-ui:archived-items-v1')
    expect(LOCAL_SESSION_REVISION_25_CAPABILITIES).toContain('host-ui:archived-items-v1')
  })
})
