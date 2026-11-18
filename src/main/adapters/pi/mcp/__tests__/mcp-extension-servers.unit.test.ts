import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openExternal: vi.fn(async (_url: string) => undefined),
  states: new Map<string, unknown>(),
}))

vi.mock('../../../../desktop-ui', () => ({ openExternal: mocks.openExternal }))
vi.mock('../openwaggle-mcp-credentials', () => ({
  getOpenWaggleMcpCredentials: () => ({
    forServer: (name: string) => ({ load: () => mocks.states.get(name) }),
  }),
}))

import { createMcpExtensionServers } from '../mcp-extension-servers'
import { createRunSignInOpener } from '../mcp-sign-in-page'

beforeEach(() => {
  mocks.openExternal.mockReset().mockResolvedValue(undefined)
  mocks.states.clear()
})

describe('MCP servers Pi extensions register', () => {
  it("open their sign-in page during a Run, like the configured servers'", async () => {
    const extensionServers = createMcpExtensionServers()
    extensionServers.capture(
      fromPartial<ExtensionAPI>({
        getMcpServers: () => [
          {
            name: 'jira',
            config: { url: 'https://mcp.jira.example/mcp' },
            extensionPath: '/ext/jira.ts',
          },
        ],
      }),
    )
    mocks.states.set('jira', { serverUrl: 'unused', oauthState: 'state-jira' })
    const open = createRunSignInOpener(() => extensionServers.entries())

    open('https://mcp.jira.example/authorize?state=state-jira')

    await vi.waitFor(() =>
      expect(mocks.openExternal).toHaveBeenCalledWith(
        'https://mcp.jira.example/authorize?state=state-jira',
      ),
    )
    expect(extensionServers.entries()).toEqual([
      expect.objectContaining({ name: 'jira', source: '/ext/jira.ts', scope: 'extension' }),
    ])
  })
})
