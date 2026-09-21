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

      expect(supportedRevisionsForCommand(payload)).toEqual([14, 13])
      expect(() => decodeLocalSessionCommandPayloadForRevision(payload, 9)).toThrow(/revision 10/)
      expect(decodeLocalSessionCommandPayloadForRevision(payload, 10)).toEqual(payload)
    },
  )

  it('keeps revision thirteen compatible and reserves native actions for revision fourteen', () => {
    const hello = {
      protocol: 'openwaggle-local-session',
      supportedRevisions: [13, 12],
      clientKind: 'gui',
      clientVersion: 'test',
    } as const
    const current = negotiateLocalSessionProtocol(hello, 'host-current')
    expect(current).toEqual({
      accepted: true,
      protocol: hello.protocol,
      revision: 13,
      hostInstanceId: 'host-current',
      capabilities: LOCAL_SESSION_REVISION_13_CAPABILITIES,
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
    expect(decodeLocalSessionNegotiationResult(current)).toEqual(current)

    const latest = negotiateLocalSessionProtocol(
      { ...hello, supportedRevisions: [14, 13] },
      'latest',
    )
    if (!latest.accepted) throw new Error('Expected revision-fourteen negotiation.')
    expect(latest.revision).toBe(14)
    expect(latest.capabilities).toEqual(LOCAL_SESSION_CAPABILITIES)
    expect(latest.capabilities).toContain('desktop:services-v1')
    expect(latest.capabilities).toContain('host-ui:session-project-catalog-v1')
    expect(latest.capabilities).toContain('host-ui:turn-diff-files-v1')
    expect(decodeLocalSessionNegotiationResult(latest)).toEqual(latest)
    expect(
      negotiateLocalSessionProtocol({ ...hello, supportedRevisions: [9] }, 'old').accepted,
    ).toBe(false)
    expect(() => decodeLocalSessionNegotiationResult({ ...current, revision: 11 })).toThrow()
    expect(() => decodeLocalSessionNegotiationResult({ ...current, revision: 14 })).toThrow()
    expect(() => decodeLocalSessionNegotiationResult({ ...latest, revision: 11 })).toThrow()
  })
})
