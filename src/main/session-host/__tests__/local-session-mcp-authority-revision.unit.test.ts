import { describe, expect, it } from 'vitest'
import {
  decodeLocalSessionCommandPayload,
  decodeLocalSessionCommandPayloadForRevision,
  decodeLocalSessionNegotiationResult,
} from '../../../shared/schemas/local-session-protocol'
import { HOST_UI_REVISION_24_REQUIRED_CHANNELS } from '../../../shared/types/host-ui-protocol'
import {
  LOCAL_SESSION_REVISION_23_CAPABILITIES,
  LOCAL_SESSION_REVISION_24_CAPABILITIES,
} from '../../../shared/types/local-session-protocol-revisions'
import { supportedRevisionsForCommand } from '../local-session-client'

function hostUiCommand(channel: string) {
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
  it('rejects a revision-fifteen success reply despite its published capability tuple', () => {
    expect(() =>
      decodeLocalSessionNegotiationResult({
        accepted: true,
        protocol: 'openwaggle-local-session',
        revision: 15,
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
          'desktop:services-v1',
          'host-ui:session-project-catalog-v1',
          'host-ui:turn-diff-files-v1',
          'updates:channel-v1',
          'events:worktree-launch-v1',
        ],
      }),
    ).toThrow()
  })

  it('routes the remaining MCP Host operations through any supported Host revision', () => {
    for (const channel of ['mcp:list-secrets', 'mcp:read-resource', 'mcp:call-app-tool']) {
      const command = hostUiCommand(channel)
      expect(decodeLocalSessionCommandPayloadForRevision(command, 6)).toEqual(command)
      expect(supportedRevisionsForCommand(command)).toEqual([29])
    }
  })

  it.each([...HOST_UI_REVISION_24_REQUIRED_CHANNELS])(
    'requires a revision-24 Host for the MCP configuration channel %s',
    (channel) => {
      const command = hostUiCommand(channel)
      expect(supportedRevisionsForCommand(command)).toEqual([29])
      expect(() => decodeLocalSessionCommandPayloadForRevision(command, 23)).toThrow(/revision 24/)
      expect(decodeLocalSessionCommandPayloadForRevision(command, 24)).toEqual(command)
    },
  )

  it('ships MCP Registry search and install with the revision-24 configuration channels', () => {
    expect(HOST_UI_REVISION_24_REQUIRED_CHANNELS).toEqual(
      expect.arrayContaining([
        'mcp:search-registry',
        'mcp:get-registry-server',
        'mcp:install-registry-server',
      ]),
    )
  })

  it('ships the per-Session MCP switch with the revision-24 configuration channels', () => {
    expect(HOST_UI_REVISION_24_REQUIRED_CHANNELS).toEqual(
      expect.arrayContaining(['mcp:get-session-enabled', 'mcp:set-session-enabled']),
    )
  })

  it('advertises the MCP configuration capability at revision 24 only', () => {
    expect(LOCAL_SESSION_REVISION_23_CAPABILITIES).not.toContain('host-ui:mcp-configuration-v1')
    expect(LOCAL_SESSION_REVISION_24_CAPABILITIES).toContain('host-ui:mcp-configuration-v1')
  })

  it.each([
    'mcp:get-settings',
    'mcp:logout-server',
    'mcp:authorize-server',
    'mcp:list-capabilities',
    'mcp:list-events',
  ])('no longer accepts the removed %s Host operation', (channel) => {
    expect(() => hostUiCommand(channel)).toThrow()
  })
})
