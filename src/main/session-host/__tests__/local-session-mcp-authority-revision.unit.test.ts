import { describe, expect, it } from 'vitest'
import {
  decodeLocalSessionCommandPayload,
  decodeLocalSessionCommandPayloadForRevision,
  decodeLocalSessionNegotiationResult,
} from '../../../shared/schemas/local-session-protocol'
import { supportedRevisionsForCommand } from '../local-session-client'

function hostUiCommand(channel: 'mcp:get-settings' | 'mcp:logout-server' | 'mcp:authorize-server') {
  return decodeLocalSessionCommandPayload({
    contract: 'host-ui-v1',
    request: {
      contractVersion: 1,
      requestId: `request-${channel}`,
      channel,
      args: [],
    },
  })
}

describe('Local Session MCP authority protocol revision', () => {
  it('preserves the exact immediately previous revision-ten capability tuple', () => {
    expect(() =>
      decodeLocalSessionNegotiationResult({
        accepted: true,
        protocol: 'openwaggle-local-session',
        revision: 10,
        hostInstanceId: 'host-mcp-ui',
        capabilities: [
          'events:subscribe',
          'events:replay',
          'sessions:mutate-v2',
          'sessions:query-v2',
          'sessions:snapshot',
          'access:profiles-v1',
          'ui:mutate-v1',
          'waggle:run-v1',
          'waggle:cancel-v1',
          'ui:compact-v1',
          'host-ui:invoke-v1',
          'host-ui:mcp-auth-v2',
          'sessions:steer-receipt-v1',
          'host-ui:workspace-authorization-v1',
          'host-ui:visualization-source-v1',
          'host-ui:authorization-grants-v1',
        ],
      }),
    ).not.toThrow()
  })

  it('accepts legacy logout while rejecting the authorization command added in revision seven', () => {
    const logout = hostUiCommand('mcp:logout-server')
    expect(decodeLocalSessionCommandPayloadForRevision(logout, 6)).toEqual(logout)
    expect(decodeLocalSessionCommandPayloadForRevision(logout, 7)).toEqual(logout)

    const authorize = hostUiCommand('mcp:authorize-server')
    expect(() => decodeLocalSessionCommandPayloadForRevision(authorize, 6)).toThrow(/revision 7/)
    expect(decodeLocalSessionCommandPayloadForRevision(authorize, 7)).toEqual(authorize)
  })

  it('forces changed authority commands to upgrade a revision-six Host', () => {
    expect(supportedRevisionsForCommand(hostUiCommand('mcp:get-settings'))).toEqual([11, 10])
    expect(supportedRevisionsForCommand(hostUiCommand('mcp:logout-server'))).toEqual([11, 10])
    expect(supportedRevisionsForCommand(hostUiCommand('mcp:authorize-server'))).toEqual([11, 10])
  })
})
