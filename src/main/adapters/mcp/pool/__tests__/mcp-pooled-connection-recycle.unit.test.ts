import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpPooledConnection } from '../mcp-pooled-connection'
import type { JsonRpcMessage, JsonRpcRequest } from '../mcp-wire'
import { collect, FakeUpstream, flush, initializeRequest } from './fake-upstream'

const TOOLS = { tools: [{ name: 'search', inputSchema: { type: 'object' } }] }

/**
 * A server process that answers `initialize` and lists its tools, and, once `stuck`, fails every
 * request of the methods in `failing` with JSON-RPC "Internal error", as Datadog's stdio proxy does
 * after its upstream HTTP connection breaks: the process never recovers on its own.
 */
function server(state: { stuck: boolean; failing?: readonly string[] }) {
  const failing = state.failing ?? ['tools/list']
  const upstream: FakeUpstream = new FakeUpstream((request: JsonRpcRequest) => {
    if (state.stuck && failing.includes(request.method)) {
      queueMicrotask(() =>
        upstream.push({
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32_603, message: 'Internal error' },
        }),
      )
      return undefined
    }
    if (request.method === 'tools/list') return TOOLS
    if (request.method === 'tools/call') return undefined
    return {}
  })
  return upstream
}

/** A server process that starts but answers `initialize` with an error. */
class FailingInitializeUpstream extends FakeUpstream {
  override async send(message: JsonRpcMessage) {
    if ('method' in message && message.method === 'initialize' && 'id' in message) {
      this.received.push(message)
      const { id } = message
      queueMicrotask(() =>
        this.push({ jsonrpc: '2.0', id, error: { code: -32_603, message: 'Not ready' } }),
      )
      return
    }
    return super.send(message)
  }
}

function pooled(upstreams: FakeUpstream[]) {
  const opened: FakeUpstream[] = []
  const connection = new McpPooledConnection({
    serverName: 'datadog',
    open: () => {
      const next = upstreams[opened.length]
      if (!next) throw new Error('No more server processes')
      opened.push(next)
      return { transport: next, stderrTail: () => '' }
    },
    onClosed: () => {},
  })
  return { connection, opened }
}

/** One Run's Pi client: attaches, initializes, and lists the tools, as Pi's MCP client does. */
async function run(connection: McpPooledConnection) {
  const lease = connection.attach()
  const client = collect(lease)
  await lease.start()
  await lease.send(initializeRequest(1))
  await lease.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  await lease.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  await flush()
  await flush()
  return {
    lease,
    client,
    listing: client.messages.find((message) => 'id' in message && message.id === 2),
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('a pooled MCP connection whose server process gets stuck', () => {
  it('replaces the process and lists the tools again, so the Run never sees the failure', async () => {
    const stuck = { stuck: false }
    const first = server(stuck)
    const fresh = server({ stuck: false })
    const { connection, opened } = pooled([first, fresh])
    expect((await run(connection)).listing).toMatchObject({ result: TOOLS })

    stuck.stuck = true
    const next = await run(connection)

    expect(next.listing).toEqual({ jsonrpc: '2.0', id: 2, result: TOOLS })
    expect(next.client.closed).toBe(false)
    expect(opened).toEqual([first, fresh])
    expect(first.closed).toBe(true)
    // The fresh process is initialized as the first one was, before the listing is sent again.
    expect(fresh.methods()).toEqual(['initialize', 'notifications/initialized', 'tools/list'])
    expect(connection.isReady).toBe(true)
  })

  it('reports the failure when a fresh process fails the same way, and lets the next Run start over', async () => {
    const { connection, opened } = pooled([server({ stuck: true }), server({ stuck: true })])

    const { listing } = await run(connection)

    expect(listing).toMatchObject({ error: { code: -32_603, message: 'Internal error' } })
    expect(opened).toHaveLength(2)
    // Not reused by the next Run, which opens its own process.
    expect(connection.isClosed).toBe(true)
  })

  it('replaces a process at most once a minute', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const firstState = { stuck: true }
    const freshState = { stuck: false }
    const { connection, opened } = pooled([
      server(firstState),
      server(freshState),
      server({ stuck: false }),
    ])
    expect((await run(connection)).listing).toMatchObject({ result: TOOLS })

    freshState.stuck = true
    vi.setSystemTime(Date.now() + 30_000)
    const tooSoon = await run(connection)

    expect(tooSoon.listing).toMatchObject({ error: { message: 'Internal error' } })
    expect(opened).toHaveLength(2)
    expect(connection.isClosed).toBe(true)
  })

  it('retires instead of replacing when two listings are open on the stuck process at once', async () => {
    // Replacing the process while another request waits on it would lose that request's answer,
    // so both clients get the error and the next Run opens its own process.
    const stuck = { stuck: false }
    const { connection, opened } = pooled([server(stuck), server({ stuck: false })])
    await run(connection)
    const leases = [connection.attach(), connection.attach()]
    const clients = leases.map((lease) => collect(lease))
    for (const lease of leases) {
      await lease.start()
      await lease.send(initializeRequest(1))
      await lease.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    }
    await flush()

    stuck.stuck = true
    await Promise.all(
      leases.map((lease) => lease.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })),
    )
    await flush()
    await flush()

    const listings = clients.map((client) =>
      client.messages.find((message) => 'id' in message && message.id === 2),
    )
    expect(listings).toEqual([
      expect.objectContaining({ error: expect.objectContaining({ message: 'Internal error' }) }),
      expect.objectContaining({ error: expect.objectContaining({ message: 'Internal error' }) }),
    ])
    expect(opened).toHaveLength(1)
    expect(connection.isClosed).toBe(true)
  })

  it('retires when the fresh process starts but fails its initialize', async () => {
    const stuck = { stuck: false }
    const fresh = new FailingInitializeUpstream()
    const { connection, opened } = pooled([server(stuck), fresh])
    await run(connection)

    stuck.stuck = true
    const next = await run(connection)

    expect(next.listing).toMatchObject({ error: { message: 'Internal error' } })
    expect(opened).toEqual([expect.anything(), fresh])
    expect(fresh.methods()).toEqual(['initialize'])
    expect(connection.isClosed).toBe(true)
  })

  it('does not send a failed tool call again, since running a tool twice may do its work twice', async () => {
    const stuck = { stuck: false, failing: ['tools/call'] }
    const { connection, opened } = pooled([server(stuck), server({ stuck: false })])
    const { lease, client } = await run(connection)

    stuck.stuck = true
    await lease.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search' } })
    await flush()
    await flush()

    expect(client.messages.at(-1)).toMatchObject({ id: 3, error: { message: 'Internal error' } })
    expect(opened).toHaveLength(1)
    expect(connection.isClosed).toBe(false)
  })

  it('keeps the process while another request is still open on it, and retires it instead', async () => {
    const stuck = { stuck: false }
    const { connection, opened } = pooled([server(stuck), server({ stuck: false })])
    const { lease } = await run(connection)
    // A tool call still running in the first process.
    await lease.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'slow' } })

    stuck.stuck = true
    const next = await run(connection)

    expect(next.listing).toMatchObject({ error: { message: 'Internal error' } })
    expect(opened).toHaveLength(1)
    // Retired: the open tool call may still finish, but the next Run opens its own process.
    expect(connection.isClosed).toBe(true)
    expect(() => connection.attach()).toThrow()
  })
})
