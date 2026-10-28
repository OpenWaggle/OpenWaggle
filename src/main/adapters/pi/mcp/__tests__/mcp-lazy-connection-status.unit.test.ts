import { afterEach, describe, expect, it } from 'vitest'
import {
  FakeUpstream,
  flush,
  INITIALIZE_RESULT,
  initializeRequest,
} from '../../../mcp/pool/__tests__/fake-upstream'
import { memoryMcpToolCatalogStore } from '../../../mcp/pool/mcp-connection-catalog'
import { McpSessionConnectionPool } from '../../../mcp/pool/mcp-session-connection-pool'
import {
  forgetKnownMcpServerStates,
  knownMcpServerState,
  recordMcpServerCheck,
} from '../mcp-server-status-registry'
import { openWaggleMcpConnectionHooks } from '../mcp-session-context'

const IDENTITY = 'browser\0stdio\0browser-mcp'
const TOOLS = { tools: [{ name: 'take_screenshot', inputSchema: { type: 'object' } }] }

afterEach(() => forgetKnownMcpServerStates())

/** A pool whose `browser` server has a fresh catalog, so a lease is answered without starting it. */
function lazyPool() {
  const store = memoryMcpToolCatalogStore()
  store.write('browser-key', {
    initialize: INITIALIZE_RESULT,
    toolsPages: { '': TOOLS },
    savedAt: Date.now(),
  })
  const upstreams: FakeUpstream[] = []
  const pool = new McpSessionConnectionPool({
    catalogStore: store,
    hooks: openWaggleMcpConnectionHooks,
  })
  const spec = {
    name: 'browser',
    fingerprint: 'v1',
    identity: IDENTITY,
    projectPath: null,
    catalogKey: 'browser-key',
    lazyStart: true,
    open: () => {
      const upstream = new FakeUpstream((request) =>
        request.method === 'tools/list' ? TOOLS : undefined,
      )
      upstreams.push(upstream)
      return { transport: upstream }
    },
  }
  return { pool, spec, upstreams }
}

async function connect(lease: ReturnType<McpSessionConnectionPool['lease']>) {
  await lease.start()
  await lease.send(initializeRequest(1))
  await lease.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  await lease.send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
  await flush()
}

describe('a lazy connection served from its catalog (review R5 P2-4)', () => {
  it('is not reported as a connected server before its server starts', async () => {
    const { pool, spec, upstreams } = lazyPool()
    await connect(pool.lease('s1', spec))

    expect(upstreams).toHaveLength(0)
    expect(pool.connectionStates(IDENTITY, null)).toEqual([])
  })

  it('does not replace a failed check with "connected"', async () => {
    recordMcpServerCheck(IDENTITY, {
      name: 'browser',
      state: 'failed',
      tools: [],
      error: 'command not found',
    })
    const { pool, spec } = lazyPool()
    await connect(pool.lease('s1', spec))

    expect(knownMcpServerState(IDENTITY)).toMatchObject({ state: 'failed' })
  })

  it('reports the server connected once a call started it', async () => {
    const { pool, spec, upstreams } = lazyPool()
    const lease = pool.lease('s1', spec)
    await connect(lease)
    await lease.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'x' } })
    await flush()
    await flush()

    expect(upstreams).toHaveLength(1)
    expect(pool.connectionStates(IDENTITY, null)).toEqual([{ ready: true }])
    expect(knownMcpServerState(IDENTITY)).toMatchObject({ state: 'connected' })
  })
})
