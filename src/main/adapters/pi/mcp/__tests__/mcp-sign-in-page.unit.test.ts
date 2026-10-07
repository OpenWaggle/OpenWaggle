import type { McpServerEntry } from '@earendil-works/pi-coding-agent'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openExternal: vi.fn(async (_url: string) => undefined),
  states: new Map<string, unknown>(),
  warn: vi.fn(),
}))

vi.mock('../../../../desktop-ui', () => ({ openExternal: mocks.openExternal }))
vi.mock('../../../../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: mocks.warn, error: vi.fn() }),
}))
vi.mock('../openwaggle-mcp-credentials', () => ({
  getOpenWaggleMcpCredentials: () => ({
    forServer: (name: string) => ({ load: () => mocks.states.get(name) }),
    tokens: () => undefined,
  }),
}))

import { createRunSignInOpener, showSignInPage } from '../mcp-sign-in-page'

const DOCS: McpServerEntry = {
  name: 'docs',
  config: { url: 'https://docs.example.com/mcp' },
  source: '/home/user/.pi/agent/mcp.json',
  scope: 'global',
}
const LINEAR: McpServerEntry = {
  name: 'linear',
  config: { url: 'https://mcp.linear.example/mcp' },
  source: '/home/user/.pi/agent/mcp.json',
  scope: 'global',
}

function pending(name: string, oauthState: string, authorizationServerUrl?: string) {
  mocks.states.set(name, {
    serverUrl: 'unused',
    oauthState,
    ...(authorizationServerUrl ? { discovery: { authorizationServerUrl } } : {}),
  })
}

async function settle() {
  await vi.waitFor(() =>
    expect(mocks.openExternal.mock.calls.length + mocks.warn.mock.calls.length).toBeGreaterThan(0),
  )
}

beforeEach(() => {
  mocks.openExternal.mockReset().mockResolvedValue(undefined)
  mocks.warn.mockReset()
  mocks.states.clear()
})

describe("a Run's /mcp sign-in page (Pi's openUrl)", () => {
  const open = createRunSignInOpener(() => [DOCS, LINEAR])

  it("opens the page of the server whose pending sign-in issued the page's state", async () => {
    pending('docs', 'state-docs')
    pending('linear', 'state-linear', 'https://auth.linear.example')

    open('https://auth.linear.example/authorize?state=state-linear&client_id=c')
    await settle()

    expect(mocks.openExternal).toHaveBeenCalledWith(
      'https://auth.linear.example/authorize?state=state-linear&client_id=c',
    )
  })

  it.each([
    ['a file URL', 'file:///etc/passwd?state=state-docs'],
    ['an SMB share', 'smb://docs.example.com/share?state=state-docs'],
    ['ms-msdt', 'ms-msdt:/id?state=state-docs'],
    ['a host that is not the server', 'https://evil.example/authorize?state=state-docs'],
    ['another server page with this server state', 'https://mcp.linear.example/a?state=state-docs'],
    ['a page no pending sign-in issued', 'https://docs.example.com/authorize?state=unknown'],
    ['a page without a state', 'https://docs.example.com/authorize'],
  ])('never opens %s', async (_case, href) => {
    pending('docs', 'state-docs')

    open(href)
    await settle()

    expect(mocks.openExternal).not.toHaveBeenCalled()
    expect(mocks.warn).toHaveBeenCalledWith('Did not open the MCP sign-in page', expect.anything())
  })
})

describe("the Host's sign-in page (Settings and the CLI)", () => {
  it('opens a page on the server or its discovered authorization server', async () => {
    pending('docs', 'state', 'https://login.example.org')

    await expect(showSignInPage(DOCS, 'https://login.example.org/authorize')).resolves.toEqual({
      kind: 'opened',
    })
    expect(mocks.openExternal).toHaveBeenCalledWith('https://login.example.org/authorize')
  })

  it('refuses an unsafe page without opening anything', async () => {
    const outcome = await showSignInPage(DOCS, 'smb://docs.example.com/share')

    expect(outcome.kind).toBe('refused')
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })

  it('hands a safe page back when the browser cannot be opened, as during automation', async () => {
    mocks.openExternal.mockRejectedValue(new Error('Blocked native desktop UI'))

    await expect(showSignInPage(DOCS, 'https://docs.example.com/authorize')).resolves.toEqual({
      kind: 'not-opened',
      href: 'https://docs.example.com/authorize',
    })
  })
})
