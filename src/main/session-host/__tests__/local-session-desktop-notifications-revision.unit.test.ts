import { describe, expect, it } from 'vitest'
import {
  decodeLocalSessionCommandPayload,
  decodeLocalSessionCommandPayloadForRevision,
} from '../../../shared/schemas/local-session-protocol'
import { HOST_UI_REVISION_31_REQUIRED_CHANNELS } from '../../../shared/types/host-ui-protocol'
import {
  LOCAL_SESSION_REVISION_30_CAPABILITIES,
  LOCAL_SESSION_REVISION_31_CAPABILITIES,
} from '../../../shared/types/local-session-protocol-revisions'
import { supportedRevisionsForCommand } from '../local-session-client'

const LIST = decodeLocalSessionCommandPayload({
  contract: 'host-ui-v1',
  request: {
    contractVersion: 1,
    requestId: 'request-list',
    channel: 'desktop-notifications:list',
    args: [],
  },
})

describe('Local Session Desktop notifications protocol revision', () => {
  it('ships the outstanding-notifications channel (ADR 0062)', () => {
    expect(HOST_UI_REVISION_31_REQUIRED_CHANNELS).toEqual(['desktop-notifications:list'])
  })

  it('sends desktop-notifications:list only to a revision-31 Host', () => {
    expect(supportedRevisionsForCommand(LIST)).toEqual([31])
    expect(() => decodeLocalSessionCommandPayloadForRevision(LIST, 30)).toThrow(/revision 31/)
    expect(decodeLocalSessionCommandPayloadForRevision(LIST, 31)).toEqual(LIST)
  })

  it('advertises the Desktop notifications capability from revision 31', () => {
    expect(LOCAL_SESSION_REVISION_30_CAPABILITIES).not.toContain('host-ui:desktop-notifications-v1')
    expect(LOCAL_SESSION_REVISION_31_CAPABILITIES).toContain('host-ui:desktop-notifications-v1')
  })
})
