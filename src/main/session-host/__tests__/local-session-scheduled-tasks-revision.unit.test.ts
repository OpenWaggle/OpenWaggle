import { describe, expect, it } from 'vitest'
import {
  decodeLocalSessionCommandPayload,
  decodeLocalSessionCommandPayloadForRevision,
} from '../../../shared/schemas/local-session-protocol'
import {
  LOCAL_SESSION_REVISION_25_CAPABILITIES,
  LOCAL_SESSION_REVISION_26_CAPABILITIES,
} from '../../../shared/types/local-session-protocol-revisions'
import { supportedRevisionsForCommand } from '../local-session-client'

const listCommand = {
  contract: 'scheduled-tasks-v1',
  request: { contractVersion: 1, requestId: 'request-1', command: { operation: 'list' } },
}

describe('Local Session Scheduled tasks protocol revision', () => {
  it('sends Scheduled task commands only to a revision-26 Host', () => {
    const command = decodeLocalSessionCommandPayload(listCommand)
    expect(supportedRevisionsForCommand(command)).toEqual([27])
    expect(() => decodeLocalSessionCommandPayloadForRevision(command, 25)).toThrow(/revision 26/)
    expect(decodeLocalSessionCommandPayloadForRevision(command, 26)).toEqual(command)
  })

  it('advertises the Scheduled tasks capability from revision 26', () => {
    expect(LOCAL_SESSION_REVISION_25_CAPABILITIES).not.toContain('scheduled-tasks:v1')
    expect(LOCAL_SESSION_REVISION_26_CAPABILITIES).toContain('scheduled-tasks:v1')
  })

  it('refuses a malformed schedule before it reaches the Host', () => {
    expect(() =>
      decodeLocalSessionCommandPayload({
        contract: 'scheduled-tasks-v1',
        request: {
          contractVersion: 1,
          requestId: 'request-2',
          command: {
            operation: 'create',
            input: {
              name: 'Monitor',
              prompt: 'Check CI',
              enabled: true,
              schedule: { kind: 'daily', at: '25:00' },
              target: { kind: 'heartbeat', sessionId: 'session-1' },
            },
          },
        },
      }),
    ).toThrow()
  })
})
