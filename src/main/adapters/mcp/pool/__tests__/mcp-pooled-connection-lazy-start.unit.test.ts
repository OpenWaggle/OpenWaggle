import { describe, expect, it } from 'vitest'
import {
  MCP_TOOL_CATALOG_MAX_AGE_MS,
  type McpToolCatalog,
  memoryMcpToolCatalogStore,
} from '../mcp-connection-catalog'
import { McpSessionConnectionPool } from '../mcp-session-connection-pool'
import { collect, FakeUpstream, flush, INITIALIZE_RESULT, initializeRequest } from './fake-upstream'

const TOOLS = { tools: [{ name: 'take_screenshot', inputSchema: { type: 'object' } }] }
const INSTRUCTED = { ...INITIALIZE_RESULT, instructions: 'Drives a browser.' }

function harness(respondTools: () => unknown = () => TOOLS) {
  const store = memoryMcpToolCatalogStore()
  const upstreams: FakeUpstream[] = []
  const pool = new McpSessionConnectionPool({ catalogStore: store })
  const spec = {
    name: 'browser',
    fingerprint: 'v1',
    catalogKey: 'browser-key',
    lazyStart: true,
    open: () => {
      const upstream = new FakeUpstream((request) => {
        if (request.method === 'tools/list') return respondTools()
        if (request.method === 'tools/call') return { content: [{ type: 'text', text: 'ok' }] }
        return undefined
      })
      upstreams.push(upstream)
      return { transport: upstream }
    },
  }
  return { store, upstreams, pool, spec }
}

/** What Pi's MCP client sends when it connects: initialize, initialized, tools/list. */
async function connect(lease: ReturnType<McpSessionConnectionPool['lease']>) {
  await lease.start()
  await lease.send(initializeRequest(1))
  await lease.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  await lease.send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
  await flush()
}

function seeded(savedAt = Date.now()): McpToolCatalog {
  return { initialize: INSTRUCTED, toolsPages: { '': TOOLS }, savedAt }
}

describe('MCP connection catalogs and lazy start (D1.3)', () => {
  it('records the handshake and tools of a server that starts with its Session', async () => {
    const { store, upstreams, pool, spec } = harness()
    await connect(pool.lease('s1', spec))

    expect(upstreams).toHaveLength(1)
    expect(store.read('browser-key')).toMatchObject({
      initialize: INITIALIZE_RESULT,
      toolsPages: { '': TOOLS },
    })
  })

  it('answers a new Session from the catalog and starts its server on the first call', async () => {
    const { store, upstreams, pool, spec } = harness()
    store.write('browser-key', seeded())
    const lease = pool.lease('s2', spec)
    const client = collect(lease)
    await connect(lease)

    // Tools are known at once and nothing was spawned.
    expect(upstreams).toHaveLength(0)
    expect(client.messages).toEqual([
      { jsonrpc: '2.0', id: 1, result: INSTRUCTED },
      { jsonrpc: '2.0', id: 2, result: TOOLS },
    ])

    await lease.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'take_screenshot', arguments: {} },
    })
    await flush()
    await flush()

    expect(upstreams).toHaveLength(1)
    // Initialized as the client was; the tools are checked beside the call.
    expect(upstreams[0]?.methods()).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/list',
      'tools/call',
    ])
    expect(client.messages.at(-1)).toEqual({
      jsonrpc: '2.0',
      id: 3,
      result: { content: [{ type: 'text', text: 'ok' }] },
    })
    // Same tools as the catalog: clients are not told to re-list.
    expect(client.messages.some((message) => 'method' in message)).toBe(false)
  })

  it('tells clients to re-list when the started server offers other tools', async () => {
    const changed = { tools: [...TOOLS.tools, { name: 'click', inputSchema: { type: 'object' } }] }
    const { store, pool, spec } = harness(() => changed)
    store.write('browser-key', seeded())
    const lease = pool.lease('s3', spec)
    const client = collect(lease)
    await connect(lease)
    await lease.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'x' } })
    await flush()
    await flush()

    expect(client.messages).toContainEqual({
      jsonrpc: '2.0',
      method: 'notifications/tools/list_changed',
    })
    expect(store.read('browser-key')?.toolsPages).toEqual({ '': changed })
  })

  it('forgets the catalog of a server that fails to start, so the next Session shows why', async () => {
    const { store, upstreams, pool, spec } = harness()
    store.write('browser-key', seeded())
    const failing = {
      ...spec,
      open: () => {
        const upstream = new FakeUpstream()
        upstream.failStart = new Error('command not found')
        upstreams.push(upstream)
        return { transport: upstream }
      },
    }
    const lease = pool.lease('s4', failing)
    await connect(lease)
    await expect(
      lease.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'x' } }),
    ).rejects.toThrow('command not found')
    expect(store.read('browser-key')).toBeUndefined()
  })

  it('starts the server at once when the catalog is a day old, or for a URL server', async () => {
    const stale = harness()
    stale.store.write('browser-key', seeded(Date.now() - MCP_TOOL_CATALOG_MAX_AGE_MS))
    await connect(stale.pool.lease('s5', stale.spec))
    expect(stale.upstreams).toHaveLength(1)

    const eager = harness()
    eager.store.write('browser-key', seeded())
    await connect(eager.pool.lease('s6', { ...eager.spec, lazyStart: false }))
    expect(eager.upstreams).toHaveLength(1)
  })
})
