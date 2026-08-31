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
  it('preserves the exact revision-six capability tuple', () => {
    expect(() =>
      decodeLocalSessionNegotiationResult({
        accepted: true,
        protocol: 'openwaggle-local-session',
        revision: 6,
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
        ],
      }),
    ).not.toThrow()
  })

  it('rejects changed OAuth authority commands on revision six', () => {
    for (const channel of ['mcp:logout-server', 'mcp:authorize-server'] as const) {
      const command = hostUiCommand(channel)
      expect(() => decodeLocalSessionCommandPayloadForRevision(command, 6)).toThrow(/revision 7/)
      expect(decodeLocalSessionCommandPayloadForRevision(command, 7)).toEqual(command)
    }
  })

  it('forces changed authority commands to upgrade a revision-six Host', () => {
    expect(supportedRevisionsForCommand(hostUiCommand('mcp:get-settings'))).toEqual([7, 6])
    expect(supportedRevisionsForCommand(hostUiCommand('mcp:logout-server'))).toEqual([7])
    expect(supportedRevisionsForCommand(hostUiCommand('mcp:authorize-server'))).toEqual([7])
  })
})
