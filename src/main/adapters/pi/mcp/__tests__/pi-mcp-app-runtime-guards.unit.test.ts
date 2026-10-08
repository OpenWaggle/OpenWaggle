import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeUpstream, flush } from '../../../mcp/pool/__tests__/fake-upstream'

const mocks = vi.hoisted(() => {
  const upstreams: FakeUpstream[] = []
  return {
    upstreams,
    respond: (_method: string): unknown => ({}),
    open: vi.fn(),
    entry: {
      name: 'figma',
      config: {
        url: 'https://figma.example/mcp',
        toolExposure: { delete_file: 'hidden' as const },
        oauth: { clientId: 'client', clientSecret: '${FIGMA_SECRET}' },
      },
      source: '/home/user/.pi/agent/mcp.json',
      scope: 'global' as const,
    },
  }
})

vi.mock('../../../../store/session-details/session-mcp-server-allowlist', () => ({
  readSessionMcpServerAllowlist: async () => undefined,
}))
vi.mock('../../../../store/session-mcp-switch', () => ({ isSessionMcpEnabled: async () => true }))
vi.mock('../../pi-provider-catalog', () => ({ getPiAgentDir: () => '/home/user/.pi/agent' }))
vi.mock('../../../../mcp-shell-environment', () => ({
  mcpShellEnvironmentReady: async () => undefined,
  mcpValueEnvironment: () => ({ FIGMA_SECRET: 'resolved-secret' }),
}))
vi.mock('../../../mcp/config/mcp-runtime-config', () => ({
  loadMcpRuntimeConfig: async () => ({
    loaded: { servers: [mocks.entry], errors: [] },
    transports: new Map(),
    unavailable: new Map(),
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

import { mcpConnectionFingerprint, mcpServerIdentity } from '../../../mcp/pool/mcp-server-identity'
import type { McpPoolClock } from '../../../mcp/pool/mcp-session-connection-pool'
import { McpSessionConnectionPool } from '../../../mcp/pool/mcp-session-connection-pool'
import { createPiMcpAppRuntimeService } from '../pi-mcp-app-runtime-service'
import { withShellResolvedClientSecrets } from '../pi-mcp-server-oauth'

const IDENTITY = mcpServerIdentity(mocks.entry.name, mocks.entry.config)
const APP = {
  projectPath: '/project',
  workingPath: '/project-worktree',
  sessionId: 'session-1',
  serverName: 'figma',
  serverIdentity: IDENTITY,
}

/** A clock the test moves by hand. */
function manualClock() {
  let now = 0
  const timers = new Set<{ at: number; run: () => void }>()
  const clock: McpPoolClock = {
    setTimeout: (run, ms) => {
      const timer = { at: now + ms, run }
      timers.add(timer)
      return { cancel: () => timers.delete(timer) }
    },
  }
  return {
    clock,
    advance(ms: number) {
      now += ms
      for (const timer of [...timers]) {
        if (timer.at > now) continue
        timers.delete(timer)
        timer.run()
      }
    },
  }
}

const pools: McpSessionConnectionPool[] = []

function service(pool = new McpSessionConnectionPool()) {
  pools.push(pool)
  return { pool, apps: createPiMcpAppRuntimeService(pool) }
}

beforeEach(() => {
  mocks.upstreams.length = 0
  mocks.open.mockReset()
  mocks.respond = () => ({})
})

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.closeAll()))
})

describe('MCP App tool calls', () => {
  it('refuse a tool the server hides from the model, without calling it', async () => {
    const { apps } = service()

    await expect(
      Effect.runPromise(apps.callTool({ ...APP, toolName: 'delete_file', arguments: {} })),
    ).rejects.toThrow('hidden')
    expect(mocks.upstreams[0]?.requests('tools/call') ?? []).toEqual([])
  })

  it('refuse a tool whose MCP Apps visibility leaves out apps', async () => {
    mocks.respond = (method) =>
      method === 'tools/list'
        ? {
            tools: [
              { name: 'model_only', inputSchema: {}, _meta: { ui: { visibility: ['model'] } } },
            ],
          }
        : { content: [] }
    const { apps } = service()

    await expect(
      Effect.runPromise(apps.callTool({ ...APP, toolName: 'model_only', arguments: {} })),
    ).rejects.toThrow('not available to apps')
    expect(mocks.upstreams[0]?.requests('tools/call')).toEqual([])
  })
})

describe("an MCP App's connection", () => {
  it("is the one the Session's next Run reuses, client secret resolved as Runs resolve it", async () => {
    mocks.respond = () => ({ contents: [] })
    const { pool, apps } = service()
    await Effect.runPromise(apps.readResource({ ...APP, uri: 'ui://app' }))

    const opened = pool.connection(APP.sessionId, 'figma')
    const [resolved] = withShellResolvedClientSecrets({ servers: [mocks.entry] }).servers
    const reused = pool.connectionFor(APP.sessionId, {
      name: 'figma',
      fingerprint: mcpConnectionFingerprint({
        config: resolved?.config ?? mocks.entry.config,
        transport: 'http',
        cwd: APP.workingPath,
      }),
      open: () => {
        throw new Error('a Run would not reconnect')
      },
    })

    expect(opened).toBeDefined()
    expect(reused).toBe(opened)
  })

  it('stays open while an App uses it between Runs', async () => {
    mocks.respond = () => ({ contents: [] })
    const time = manualClock()
    const idleCloseMs = 1_000
    const { pool, apps } = service(new McpSessionConnectionPool({ clock: time.clock, idleCloseMs }))
    const read = () => Effect.runPromise(apps.readResource({ ...APP, uri: 'ui://app' }))

    await read()
    time.advance(idleCloseMs * 0.8)
    await read()
    time.advance(idleCloseMs * 0.8)
    await flush()

    expect(pool.connection(APP.sessionId, 'figma')).toBeDefined()
    time.advance(idleCloseMs)
    await flush()
    expect(pool.connection(APP.sessionId, 'figma')).toBeUndefined()
  })
})
