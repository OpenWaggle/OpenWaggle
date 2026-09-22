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
  LOCAL_SESSION_REVISION_14_CAPABILITIES,
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

      expect(supportedRevisionsForCommand(payload)).toEqual([15])
      expect(() => decodeLocalSessionCommandPayloadForRevision(payload, 9)).toThrow(/revision 10/)
      expect(decodeLocalSessionCommandPayloadForRevision(payload, 10)).toEqual(payload)
    },
  )

  it('preserves published capability tuples while requiring revision fifteen for attachment', () => {
    const hello = {
      protocol: 'openwaggle-local-session',
      supportedRevisions: [14, 13],
      clientKind: 'gui',
      clientVersion: 'test',
    } as const
    const current = negotiateLocalSessionProtocol(hello, 'host-current')
    expect(current).toEqual({
      accepted: false,
      protocol: hello.protocol,
      code: 'incompatible_protocol',
      supportedRevisions: [15],
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
    expect(LOCAL_SESSION_REVISION_14_CAPABILITIES).toContain('updates:channel-v1')
    expect(LOCAL_SESSION_REVISION_14_CAPABILITIES).not.toContain('host-ui:native-actions-v1')
    expect(decodeLocalSessionNegotiationResult(current)).toEqual(current)

    const latest = negotiateLocalSessionProtocol(
      { ...hello, supportedRevisions: [15, 14] },
      'latest',
    )
    if (!latest.accepted) throw new Error('Expected revision-fifteen negotiation.')
    expect(latest.revision).toBe(15)
    expect(latest.capabilities).toEqual(LOCAL_SESSION_CAPABILITIES)
    expect(latest.capabilities).toContain('desktop:services-v1')
    expect(latest.capabilities).toContain('host-ui:session-project-catalog-v1')
    expect(latest.capabilities).toContain('host-ui:turn-diff-files-v1')
    expect(latest.capabilities).toContain('updates:channel-v1')
    expect(latest.capabilities).toContain('host-ui:native-actions-v1')
    expect(decodeLocalSessionNegotiationResult(latest)).toEqual(latest)
    expect(
      negotiateLocalSessionProtocol({ ...hello, supportedRevisions: [9] }, 'old').accepted,
    ).toBe(false)
    expect(() => decodeLocalSessionNegotiationResult({ ...current, revision: 13 })).toThrow()
    expect(() => decodeLocalSessionNegotiationResult({ ...current, revision: 15 })).toThrow()
    expect(() => decodeLocalSessionNegotiationResult({ ...latest, revision: 14 })).toThrow()
  })
})
