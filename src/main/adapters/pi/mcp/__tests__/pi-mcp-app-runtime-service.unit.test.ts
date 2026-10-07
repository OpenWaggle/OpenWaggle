import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeUpstream, flush } from '../../../mcp/pool/__tests__/fake-upstream'

const mocks = vi.hoisted(() => {
  const upstreams: FakeUpstream[] = []
  return {
    upstreams,
    respond: (_method: string): unknown => ({}),
    open: vi.fn(),
    createAuthProvider: vi.fn<(options: { readonly settings: () => unknown }) => void>(),
  }
})

const ENTRY = {
  name: 'figma',
  config: { url: 'https://figma.example/mcp', oauth: { clientId: 'openwaggle-client' } },
  source: '/home/user/.pi/agent/mcp.json',
  scope: 'global',
}

vi.mock('@earendil-works/pi-coding-agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@earendil-works/pi-coding-agent')>()
  return {
    ...actual,
    createMcpAuthProvider: (options: { readonly settings: () => unknown }) => {
      mocks.createAuthProvider(options)
      return { token: async () => 'token', settled: async () => undefined }
    },
  }
})
vi.mock('../../../../store/session-details/session-mcp-server-allowlist', () => ({
  readSessionMcpServerAllowlist: async (sessionId: string) =>
    sessionId === 'narrowed-session' ? ['docs'] : undefined,
}))
vi.mock('../../pi-provider-catalog', () => ({ getPiAgentDir: () => '/home/user/.pi/agent' }))
vi.mock('../../../mcp/config/mcp-runtime-config', () => ({
  loadMcpRuntimeConfig: async () => ({
    loaded: { servers: [ENTRY], errors: [] },
    transports: new Map(),
  }),
}))
vi.mock('../openwaggle-mcp-credentials', () => ({
  getOpenWaggleMcpCredentials: () => ({ forServer: () => ({ load: () => undefined }) }),
}))
vi.mock('../pi-mcp-upstream', () => ({
  openPiMcpUpstream: (input: unknown) => {
    mocks.open(input)
    const upstream = new FakeUpstream((request) => mocks.respond(request.method))
    mocks.upstreams.push(upstream)
    return { transport: upstream }
  },
}))

import { McpAppRuntimeService } from '../../../../ports/mcp-app-runtime-service'
import { setSessionMcpEnabled } from '../../../mcp/mcp-session-switch'
import { mcpSessionConnectionPool } from '../../../mcp/pool/mcp-connection-pool-instance'
import { mcpServerIdentity } from '../../../mcp/pool/mcp-server-identity'
import {
  MCP_APP_REQUEST_TIMEOUT_MS,
  PiMcpAppRuntimeServiceLive,
} from '../pi-mcp-app-runtime-service'

const IDENTITY = mcpServerIdentity(ENTRY.name, ENTRY.config)
const APP = {
  projectPath: '/project',
  workingPath: '/project-worktree',
  sessionId: 'session-1',
  serverName: 'figma',
  serverIdentity: IDENTITY,
}

function run<A>(use: (runtime: typeof McpAppRuntimeService.Service) => Effect.Effect<A, Error>) {
  return Effect.runPromise(
    Effect.flatMap(McpAppRuntimeService, use).pipe(Effect.provide(PiMcpAppRuntimeServiceLive)),
  )
}

beforeEach(() => {
  mocks.upstreams.length = 0
  mocks.open.mockReset()
  mocks.createAuthProvider.mockReset()
  mocks.respond = () => ({})
})

afterEach(async () => {
  vi.useRealTimers()
  await mcpSessionConnectionPool.closeAll()
})

describe("MCP Apps over the Session's connection", () => {
  it("opens a cold connection like a Run's: working path, OAuth settings, identity", async () => {
    mocks.respond = () => ({ contents: [{ uri: 'ui://app', text: '<p/>' }] })

    await run((runtime) => runtime.readResource({ ...APP, uri: 'ui://app' }))

    expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/project-worktree' }))
    const [options] = mocks.createAuthProvider.mock.calls[0] ?? []
    expect(options?.settings()).toEqual({ clientId: 'openwaggle-client' })
    expect(mcpSessionConnectionPool.connectionStates(IDENTITY)).toEqual([
      expect.objectContaining({ ready: true }),
    ])
  })

  it("lists the server's resources and prompts, and nothing for what it does not offer", async () => {
    mocks.respond = (method) =>
      method === 'resources/list' ? { resources: [{ uri: 'file:///a', name: 'a' }] } : undefined
    const listing = run((runtime) => runtime.listCatalog(APP))
    await vi.waitFor(() => expect(mocks.upstreams[0]?.requests('prompts/list')).toHaveLength(1))
    const upstream = mocks.upstreams[0]
    const [prompts] = upstream?.requests('prompts/list') ?? []
    upstream?.push({
      jsonrpc: '2.0',
      id: prompts?.id ?? 0,
      error: { code: -32601, message: 'Method not found' },
    })

    await expect(listing).resolves.toEqual({
      resources: [{ uri: 'file:///a', name: 'a' }],
      prompts: [],
    })
  })

  it('gives up on a request the server never answers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    mocks.respond = () => undefined

    const reading = run((runtime) => runtime.readResource({ ...APP, uri: 'ui://app' })).catch(
      (error: unknown) => error,
    )
    await vi.waitFor(() => expect(mocks.upstreams).toHaveLength(1))
    await flush()
    await vi.advanceTimersByTimeAsync(MCP_APP_REQUEST_TIMEOUT_MS)

    await expect(reading).resolves.toMatchObject({ message: expect.stringMatching(/in time/) })
  })

  it("refuses a server the Session's MCP switch or Agent definition rules out", async () => {
    setSessionMcpEnabled('switched-off', false)

    const off = run((runtime) =>
      runtime.readResource({ ...APP, sessionId: 'switched-off', uri: 'ui://app' }),
    )
    const narrowed = run((runtime) =>
      runtime.readResource({ ...APP, sessionId: 'narrowed-session', uri: 'ui://app' }),
    )

    await expect(off).rejects.toThrow('MCP is turned off for this Session.')
    await expect(narrowed).rejects.toThrow('does not use the MCP server "figma"')
    expect(mocks.open).not.toHaveBeenCalled()
    setSessionMcpEnabled('switched-off', true)
  })
})
