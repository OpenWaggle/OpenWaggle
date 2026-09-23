import {
  decodeLocalSessionCommandPayload,
  decodeLocalSessionCommandPayloadForRevision,
  decodeLocalSessionNegotiationResult,
} from '@shared/schemas/local-session-protocol'
import {
  LOCAL_SESSION_CAPABILITIES,
  LOCAL_SESSION_REVISION_10_CAPABILITIES,
  LOCAL_SESSION_REVISION_11_CAPABILITIES,
  LOCAL_SESSION_REVISION_12_CAPABILITIES,
  LOCAL_SESSION_REVISION_13_CAPABILITIES,
  LOCAL_SESSION_REVISION_15_CAPABILITIES,
} from '@shared/types/local-session-protocol'
import { describe, expect, it } from 'vitest'
import { supportedRevisionsForCommand } from '../local-session-client'
import { negotiateLocalSessionProtocol } from '../local-session-negotiation'

describe('Local Session authorization grant revision', () => {
  it.each(['authorization-grants:grant', 'authorization-grants:revoke'])(
    'requires revision ten for %s on both client and Host',
    (channel) => {
      const payload = decodeLocalSessionCommandPayload({
        contract: 'host-ui-v1',
        request: {
          contractVersion: 1,
          requestId: 'authorization-grant',
          channel,
          args: [
            { kind: 'value', value: '/project' },
            {
              kind: 'value',
              value: { requester: 'mcp', requesterId: 'server', capability: 'mcp.tool-call' },
            },
          ],
        },
      })

      expect(supportedRevisionsForCommand(payload)).toEqual([16, 15])
      expect(() => decodeLocalSessionCommandPayloadForRevision(payload, 9)).toThrow(/revision 10/)
      expect(decodeLocalSessionCommandPayloadForRevision(payload, 10)).toEqual(payload)
    },
  )

  it('keeps revision fifteen compatible and reserves Session resources for revision sixteen', () => {
    const hello = {
      protocol: 'openwaggle-local-session',
      supportedRevisions: [15, 14],
      clientKind: 'gui',
      clientVersion: 'test',
    } as const
    const current = negotiateLocalSessionProtocol(hello, 'host-current')
    expect(current).toEqual({
      accepted: true,
      protocol: hello.protocol,
      revision: 15,
      hostInstanceId: 'host-current',
      capabilities: LOCAL_SESSION_REVISION_15_CAPABILITIES,
    })
    expect(LOCAL_SESSION_CAPABILITIES).toContain('host-ui:authorization-grants-v1')
    expect(LOCAL_SESSION_REVISION_10_CAPABILITIES).toContain('host-ui:authorization-grants-v1')
    expect(LOCAL_SESSION_REVISION_10_CAPABILITIES).not.toContain('desktop:services-v1')
    expect(LOCAL_SESSION_REVISION_11_CAPABILITIES).toContain('desktop:services-v1')
    expect(LOCAL_SESSION_REVISION_11_CAPABILITIES).not.toContain(
      'host-ui:session-project-catalog-v1',
    )
    expect(LOCAL_SESSION_REVISION_12_CAPABILITIES).toContain('host-ui:session-project-catalog-v1')
    expect(LOCAL_SESSION_REVISION_12_CAPABILITIES).not.toContain('host-ui:turn-diff-files-v1')
    expect(LOCAL_SESSION_REVISION_13_CAPABILITIES).toContain('host-ui:turn-diff-files-v1')
    expect(LOCAL_SESSION_REVISION_13_CAPABILITIES).not.toContain('updates:channel-v1')
    expect(decodeLocalSessionNegotiationResult(current)).toEqual(current)

    const latest = negotiateLocalSessionProtocol(
      { ...hello, supportedRevisions: [16, 15] },
      'latest',
    )
    if (!latest.accepted) throw new Error('Expected revision-sixteen negotiation.')
    expect(latest.revision).toBe(16)
    expect(latest.capabilities).toEqual(LOCAL_SESSION_CAPABILITIES)
    expect(latest.capabilities).toContain('desktop:services-v1')
    expect(latest.capabilities).toContain('host-ui:session-project-catalog-v1')
    expect(latest.capabilities).toContain('host-ui:turn-diff-files-v1')
    expect(latest.capabilities).toContain('updates:channel-v1')
    expect(latest.capabilities).toContain('events:worktree-launch-v1')
    expect(latest.capabilities).toContain('host-ui:session-resources-v1')
    expect(decodeLocalSessionNegotiationResult(latest)).toEqual(latest)
    expect(
      negotiateLocalSessionProtocol({ ...hello, supportedRevisions: [9] }, 'old').accepted,
    ).toBe(false)
    expect(() => decodeLocalSessionNegotiationResult({ ...current, revision: 14 })).toThrow()
    expect(() => decodeLocalSessionNegotiationResult({ ...current, revision: 16 })).toThrow()
    expect(() => decodeLocalSessionNegotiationResult({ ...latest, revision: 15 })).toThrow()
  })
})
