import { describe, expect, it } from 'vitest'
import {
  decodeLocalSessionCommandPayload,
  decodeLocalSessionCommandPayloadForRevision,
} from '../../../shared/schemas/local-session-protocol'
import { supportedRevisionsForCommand } from '../local-session-client'

function hostUiCommand(channel: string, args: readonly unknown[]) {
  return decodeLocalSessionCommandPayload({
    contract: 'host-ui-v1',
    request: {
      contractVersion: 1,
      requestId: `request-${channel}`,
      channel,
      args: args.map((value) => ({ kind: 'value', value })),
    },
  })
}

/** Project removal and Pi session discovery (ADR 0051) need a revision-24 Host. */
describe('Local Session project removal protocol revision', () => {
  it('sends the start of a project removal only to a revision-24 Host', () => {
    const command = hostUiCommand('sessions:begin-project-removal', ['/project'])
    expect(supportedRevisionsForCommand(command)).toEqual([27])
    expect(() => decodeLocalSessionCommandPayloadForRevision(command, 23)).toThrow(/revision 24/)
  })

  it('sends a deletion for a project removal only to a Host that keeps the Pi file listable', () => {
    const removal = hostUiCommand('sessions:delete', ['session-1', { removingProject: true }])
    expect(supportedRevisionsForCommand(removal)).toEqual([27])
    expect(() => decodeLocalSessionCommandPayloadForRevision(removal, 23)).toThrow(/revision 24/)

    const plain = hostUiCommand('sessions:delete', ['session-1'])
    expect(decodeLocalSessionCommandPayloadForRevision(plain, 21)).toEqual(plain)
  })
})
