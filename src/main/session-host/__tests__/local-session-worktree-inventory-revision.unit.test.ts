import { describe, expect, it } from 'vitest'
import {
  decodeLocalSessionCommandPayload,
  decodeLocalSessionCommandPayloadForRevision,
} from '../../../shared/schemas/local-session-protocol'
import { HOST_UI_REVISION_30_REQUIRED_CHANNELS } from '../../../shared/types/host-ui-protocol'
import {
  LOCAL_SESSION_REVISION_29_CAPABILITIES,
  LOCAL_SESSION_REVISION_30_CAPABILITIES,
} from '../../../shared/types/local-session-protocol-revisions'
import { supportedRevisionsForCommand } from '../local-session-client'

function hostUiCommand(channel: string) {
  return decodeLocalSessionCommandPayload({
    contract: 'host-ui-v1',
    request: { contractVersion: 1, requestId: `request-${channel}`, channel, args: [] },
  })
}

describe('Local Session worktree inventory protocol revision', () => {
  it('ships the Settings > Worktrees channels (ADR 0060)', () => {
    expect(HOST_UI_REVISION_30_REQUIRED_CHANNELS).toEqual([
      'worktrees:inventory',
      'worktrees:measure',
      'worktrees:archive-and-remove',
      'worktrees:automatic-removal-log',
      'worktrees:acknowledge-automatic-removal',
    ])
  })

  it.each([...HOST_UI_REVISION_30_REQUIRED_CHANNELS])(
    'sends %s only to a revision-30 Host',
    (channel) => {
      const command = hostUiCommand(channel)
      expect(supportedRevisionsForCommand(command)).toEqual([30])
      expect(() => decodeLocalSessionCommandPayloadForRevision(command, 29)).toThrow(/revision 30/)
      expect(decodeLocalSessionCommandPayloadForRevision(command, 30)).toEqual(command)
    },
  )

  it('advertises the worktree inventory capability from revision 30', () => {
    expect(LOCAL_SESSION_REVISION_29_CAPABILITIES).not.toContain('host-ui:worktree-inventory-v1')
    expect(LOCAL_SESSION_REVISION_30_CAPABILITIES).toContain('host-ui:worktree-inventory-v1')
  })
})
