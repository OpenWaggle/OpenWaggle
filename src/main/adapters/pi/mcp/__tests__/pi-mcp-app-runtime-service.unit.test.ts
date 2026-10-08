import { Effect, Layer } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeUpstream, flush } from '../../../mcp/pool/__tests__/fake-upstream'

const mocks = vi.hoisted(() => {
  const upstreams: FakeUpstream[] = []
  return {
    upstreams,
    respond: (_method: string): unknown => ({}),
    open: vi.fn(),
    legacyIdentity: '',
    enabled: true,
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
    ({ 'narrowed-session': ['docs'], 'legacy-session': ['figma-1'] })[sessionId],
}))
vi.mock('../../../mcp/migration/legacy-server-names', () => ({
  readLegacyMcpServerNames: async () => new Map([['figma-1', 'figma']]),
  // As the migration recorded the old figma server: its config hash, and its target's identity.
  readLegacyMcpServerIdentities: async () =>
    new Map([['figma-1', { configHash: 'old-config-hash', identity: mocks.legacyIdentity }]]),
}))
vi.mock('../../../../store/session-mcp-switch', () => ({
  isSessionMcpEnabled: async (sessionId: string) => sessionId !== 'switched-off',
}))
vi.mock('../../pi-provider-catalog', () => ({ getPiAgentDir: () => '/home/user/.pi/agent' }))
vi.mock('../../../mcp/config/mcp-runtime-config', () => ({
  loadMcpRuntimeConfig: async () => ({
    loaded: {
      servers: [{ ...ENTRY, config: { ...ENTRY.config, enabled: mocks.enabled } }],
      errors: [],
    },
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
import { mcpServerIdentity } from '../../../mcp/pool/mcp-server-identity'
import { McpSessionConnectionPool } from '../../../mcp/pool/mcp-session-connection-pool'
import {
  createPiMcpAppRuntimeService,
  MCP_APP_REQUEST_TIMEOUT_MS,
} from '../pi-mcp-app-runtime-service'

// The service gets its pool injected; this test's own pool stands in for the Host's.
const mcpSessionConnectionPool = new McpSessionConnectionPool()
const PiMcpAppRuntimeServiceLive = Layer.succeed(
  McpAppRuntimeService,
  createPiMcpAppRuntimeService(mcpSessionConnectionPool),
)

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
  mocks.legacyIdentity = IDENTITY
  mocks.enabled = true
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
    const off = run((runtime) =>
      runtime.readResource({ ...APP, sessionId: 'switched-off', uri: 'ui://app' }),
    )
    const narrowed = run((runtime) =>
      runtime.readResource({ ...APP, sessionId: 'narrowed-session', uri: 'ui://app' }),
    )

    await expect(off).rejects.toThrow('MCP is turned off for this Session.')
    await expect(narrowed).rejects.toThrow('does not use the MCP server "figma"')
    expect(mocks.open).not.toHaveBeenCalled()
  })

  it('stops using a warm connection once its server is turned off', async () => {
    mocks.respond = () => ({ contents: [{ uri: 'ui://app', text: '<p/>' }] })
    await run((runtime) => runtime.readResource({ ...APP, uri: 'ui://app' }))

    mocks.enabled = false
    const reading = run((runtime) => runtime.readResource({ ...APP, uri: 'ui://app' }))

    await expect(reading).rejects.toThrow('is turned off')
    expect(mocks.upstreams[0]?.requests('resources/read')).toHaveLength(1)
  })

  it('opens an App from before the upgrade while its server still runs the same thing', async () => {
    mocks.respond = () => ({ contents: [{ uri: 'ui://app', text: '<p/>' }] })
    const oldDescriptor = { serverName: 'figma-1', serverIdentity: 'old-config-hash' }

    await run((runtime) => runtime.readResource({ ...APP, ...oldDescriptor, uri: 'ui://app' }))
    mocks.legacyIdentity = 'mcp-server:somewhere-else'
    const moved = run((runtime) =>
      runtime.readResource({ ...APP, ...oldDescriptor, sessionId: 'session-2', uri: 'ui://app' }),
    )

    expect(mocks.open).toHaveBeenCalledOnce()
    await expect(moved).rejects.toThrow('changed since this App opened')
  })

  it('lets a Session whose profile names the server by its old instance ID use it', async () => {
    mocks.respond = () => ({ contents: [{ uri: 'ui://app', text: '<p/>' }] })

    await run((runtime) =>
      runtime.readResource({ ...APP, sessionId: 'legacy-session', uri: 'ui://app' }),
    )

    expect(mocks.open).toHaveBeenCalled()
  })
})
