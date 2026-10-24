import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import type { OpenWaggleMcpServer } from '../openwaggle-mcp-server-policy'

vi.mock('../session-host/local-session-paths', () => ({
  prepareLocalSessionHostPaths: vi.fn(async () => ({})),
  refreshLocalSessionHostEndpoint: vi.fn(async () => ({})),
  resolveLocalSessionHostPaths: vi.fn(() => ({})),
}))

import { registerOpenWaggleSessionToolV2 } from '../openwaggle-mcp-session-tool-v2'

describe('OpenWaggle MCP Hive tool name (ADR 0053)', () => {
  it('serves Session Control only as openwaggle_hive, never under its former name', () => {
    const registerTool = vi.fn()
    registerOpenWaggleSessionToolV2(
      fromPartial<OpenWaggleMcpServer>({ registerTool }),
      {
        transport: 'stdio',
        grants: new Set(),
        workspaceRoots: [],
        sessionIds: new Set(),
        profile: 'test',
        authorizationCeiling: 'ask-for-approval',
        userDataRoot: '/user-data',
        version: 'test',
      },
      { userDataRoot: '/user-data', version: 'test' },
    )

    expect(registerTool.mock.calls.map(([name]) => name)).toEqual(['openwaggle_hive'])
    expect(registerTool).toHaveBeenCalledWith(
      'openwaggle_hive',
      expect.objectContaining({
        title: 'OpenWaggle Hive',
        description: expect.stringContaining('openwaggle hive CLI subcommand of the same name'),
      }),
      expect.any(Function),
    )
  })
})
