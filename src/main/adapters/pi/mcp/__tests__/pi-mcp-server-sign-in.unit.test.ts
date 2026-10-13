import type { McpSignInPrompt } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { Effect, Layer } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openExternal: vi.fn(async (_url: string) => undefined),
  page: 'https://docs.example.com/authorize',
  closeServerIdentity: vi.fn(async () => undefined),
}))

vi.mock('@earendil-works/pi-coding-agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@earendil-works/pi-coding-agent')>()
  return {
    ...actual,
    signInMcpServer: async (options: { readonly prompt: McpSignInPrompt }) => {
      options.prompt.showAuthorizationUrl(new URL(mocks.page))
      const cancelled = new AbortController()
      await options.prompt.promptForRedirectUrl(cancelled.signal)
      throw new actual.McpSignInCancelledError()
    },
  }
})
vi.mock('../../../../desktop-ui', () => ({ openExternal: mocks.openExternal }))
vi.mock('../../pi-provider-catalog', () => ({ getPiAgentDir: () => '/home/user/.pi/agent' }))
vi.mock('../../../mcp/config/mcp-runtime-config', () => ({
  loadMcpRuntimeConfig: async () => ({
    loaded: {
      servers: [
        {
          name: 'docs',
          config: { url: 'https://docs.example.com/mcp' },
          source: '/home/user/.pi/agent/mcp.json',
          scope: 'global',
        },
      ],
      errors: [],
    },
    transports: new Map(),
    unavailable: new Map(),
  }),
}))
vi.mock('../openwaggle-mcp-credentials', () => ({
  getOpenWaggleMcpCredentials: () => ({
    forServer: () => ({ load: () => undefined, save: () => undefined }),
    tokens: () => undefined,
  }),
}))

import { McpServerRuntimeService } from '../../../../ports/mcp-server-runtime-service'
import { createPiMcpServerRuntimeService } from '../pi-mcp-server-runtime-service'

// The service gets its connection pool injected, so a fake one records what is closed.
const PiMcpServerRuntimeServiceLive = Layer.succeed(
  McpServerRuntimeService,
  createPiMcpServerRuntimeService(fromPartial({ closeServerIdentity: mocks.closeServerIdentity })),
)

function signIn() {
  return Effect.runPromiseExit(
    Effect.flatMap(McpServerRuntimeService, (runtime) =>
      runtime.signIn({ projectPath: null, name: 'docs' }),
    ).pipe(Effect.provide(PiMcpServerRuntimeServiceLive)),
  )
}

beforeEach(() => {
  mocks.openExternal.mockReset().mockResolvedValue(undefined)
})

describe('Host-owned MCP sign-in', () => {
  it('fails without opening a sign-in page that is not on the server', async () => {
    mocks.page = 'ms-msdt:/id PCWDiagnostic'

    const exit = await signIn()

    expect(exit._tag).toBe('Failure')
    expect(JSON.stringify(exit)).toMatch(/must be https: or http:/)
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })

  it('hands the page back when the browser cannot be opened, as during automation', async () => {
    mocks.page = 'https://docs.example.com/authorize'
    mocks.openExternal.mockRejectedValue(new Error('Blocked native desktop UI'))

    const exit = await signIn()

    expect(exit).toMatchObject({
      _tag: 'Success',
      value: { signedIn: false, authorizationUrl: 'https://docs.example.com/authorize' },
    })
  })
})
