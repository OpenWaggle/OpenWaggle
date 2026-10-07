import { describe, expect, it, vi } from 'vitest'
import type { McpPooledConnectionOptions } from '../mcp-connection-support'
import { McpPooledConnection } from '../mcp-pooled-connection'
import { collect, FakeUpstream, flush, INITIALIZE_RESULT, initializeRequest } from './fake-upstream'

function connection(upstream: FakeUpstream, options: Partial<McpPooledConnectionOptions> = {}) {
  return new McpPooledConnection({
    serverName: 'fake',
    open: () => ({ transport: upstream, stderrTail: () => 'boom on stderr' }),
    onClosed: () => {},
    ...options,
  })
}

async function handshake(lease: ReturnType<McpPooledConnection['attach']>, id = 1) {
  await lease.start()
  await lease.send(initializeRequest(id))
  await lease.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  await flush()
}

describe('pooled MCP connection', () => {
  it("answers a later client's initialize from the cached handshake", async () => {
    const upstream = new FakeUpstream()
    const pooled = connection(upstream)

    const first = pooled.attach()
    const firstClient = collect(first)
    await handshake(first)
    await first.close()
    const second = pooled.attach()
    const secondClient = collect(second)
    await handshake(second, 7)

    expect(upstream.started).toBe(1)
    expect(upstream.methods()).toEqual(['initialize', 'notifications/initialized'])
    expect(firstClient.closed).toBe(true)
    expect(secondClient.messages).toEqual([{ jsonrpc: '2.0', id: 7, result: INITIALIZE_RESULT }])
    expect(upstream.protocolVersion).toBe('2025-11-25')
    expect(upstream.closed).toBe(false)
  })

  it("adds OpenWaggle's client capabilities to the first initialize only", async () => {
    const upstream = new FakeUpstream()
    const pooled = connection(upstream, {
      augmentInitializeParams: (params) => ({
        ...(typeof params === 'object' && params !== null ? params : {}),
        capabilities: { roots: {}, sampling: {}, elicitation: {} },
      }),
    })

    await handshake(pooled.attach())

    expect(upstream.requests('initialize')[0]?.params).toEqual({
      protocolVersion: '2025-11-25',
      capabilities: { roots: {}, sampling: {}, elicitation: {} },
      clientInfo: { name: 'pi', version: '1' },
    })
  })

  it('renumbers requests so clients with the same ids get their own responses', async () => {
    const upstream = new FakeUpstream((request) => ({ echo: request.params }))
    const pooled = connection(upstream)
    const a = pooled.attach()
    const b = pooled.attach()
    const aClient = collect(a)
    const bClient = collect(b)
    await handshake(a)
    await handshake(b)

    await a.send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: { from: 'a' } })
    await b.send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: { from: 'b' } })
    await flush()

    const upstreamIds = upstream.requests('tools/list').map((request) => request.id)
    expect(new Set(upstreamIds).size).toBe(2)
    expect(aClient.messages.at(-1)).toEqual({
      jsonrpc: '2.0',
      id: 2,
      result: { echo: { from: 'a' } },
    })
    expect(bClient.messages.at(-1)).toEqual({
      jsonrpc: '2.0',
      id: 2,
      result: { echo: { from: 'b' } },
    })
  })

  it('cancels a detached client’s in-flight request upstream and keeps the connection', async () => {
    const upstream = new FakeUpstream()
    const pooled = connection(upstream)
    const lease = pooled.attach()
    await handshake(lease)
    await lease.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'slow' } })
    const upstreamId = upstream.requests('tools/call')[0]?.id

    await lease.close()

    expect(upstream.received.at(-1)).toEqual({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: upstreamId, reason: 'The client detached' },
    })
    expect(pooled.isClosed).toBe(false)
    expect(pooled.attachedLeases).toBe(0)
  })

  it("maps a client's progress token and cancellation to the upstream request", async () => {
    const upstream = new FakeUpstream()
    const pooled = connection(upstream)
    const lease = pooled.attach()
    const client = collect(lease)
    await handshake(lease)
    await lease.send({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 't', _meta: { progressToken: 4 } },
    })
    const sent = upstream.requests('tools/call')[0]

    upstream.push({
      jsonrpc: '2.0',
      method: 'notifications/progress',
      params: { progressToken: sent?.id, progress: 1 },
    })
    await lease.send({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: 4 },
    })

    expect(sent?.params).toEqual({ name: 't', _meta: { progressToken: sent?.id } })
    expect(client.messages.at(-1)).toEqual({
      jsonrpc: '2.0',
      method: 'notifications/progress',
      params: { progressToken: 4, progress: 1 },
    })
    expect(upstream.received.at(-1)).toEqual({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: sent?.id },
    })
  })

  it('answers ping and roots itself and routes sampling to the handler', async () => {
    const upstream = new FakeUpstream()
    const handleServerRequest = vi.fn((request: { method: string }) =>
      request.method === 'sampling/createMessage'
        ? Promise.resolve({ role: 'assistant' })
        : undefined,
    )
    const pooled = connection(upstream, {
      roots: () => [{ uri: 'file:///work', name: 'work' }],
      handleServerRequest,
    })
    const lease = pooled.attach()
    const client = collect(lease)
    await handshake(lease)

    upstream.push({ jsonrpc: '2.0', id: 'p', method: 'ping' })
    upstream.push({ jsonrpc: '2.0', id: 'r', method: 'roots/list' })
    upstream.push({ jsonrpc: '2.0', id: 's', method: 'sampling/createMessage', params: {} })
    upstream.push({ jsonrpc: '2.0', id: 'x', method: 'custom/thing' })
    await flush()

    expect(upstream.received.slice(-4)).toEqual(
      expect.arrayContaining([
        { jsonrpc: '2.0', id: 'p', result: {} },
        { jsonrpc: '2.0', id: 'r', result: { roots: [{ uri: 'file:///work', name: 'work' }] } },
        { jsonrpc: '2.0', id: 's', result: { role: 'assistant' } },
      ]),
    )
    expect(client.messages.at(-1)).toEqual({ jsonrpc: '2.0', id: 'x', method: 'custom/thing' })
  })

  it('refuses a server request no client can answer', async () => {
    const upstream = new FakeUpstream()
    const pooled = connection(upstream)
    const lease = pooled.attach()
    await handshake(lease)
    await lease.close()

    upstream.push({ jsonrpc: '2.0', id: 9, method: 'elicitation/create', params: {} })
    await flush()

    expect(upstream.received.at(-1)).toEqual({
      jsonrpc: '2.0',
      id: 9,
      error: { code: -32_601, message: 'Method not found: elicitation/create' },
    })
  })

  it('broadcasts server notifications and closes every client when the server goes away', async () => {
    const upstream = new FakeUpstream()
    const onClosed = vi.fn()
    const pooled = connection(upstream, { onClosed })
    const lease = pooled.attach()
    const client = collect(lease)
    await handshake(lease)

    upstream.push({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' })
    upstream.crash()

    expect(client.messages.at(-1)).toEqual({
      jsonrpc: '2.0',
      method: 'notifications/tools/list_changed',
    })
    expect(client.closed).toBe(true)
    expect(pooled.isClosed).toBe(true)
    expect(onClosed).toHaveBeenCalledOnce()
    expect(() => pooled.attach()).toThrow('MCP server "fake" connection is closed')
  })

  it('tells a client waiting for its handshake why the server exited, with stderr', async () => {
    const upstream = new FakeUpstream()
    const pooled = connection(upstream)
    const lease = pooled.attach()
    const client = collect(lease)
    await lease.start()
    upstream.send = async (message) => {
      upstream.received.push(message)
    }
    const sent = lease.send(initializeRequest(1))
    await flush()

    upstream.crash()
    await sent

    expect(client.messages).toEqual([
      {
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32_603,
          message: 'MCP server "fake" closed the connection\nboom on stderr',
        },
      },
    ])
    expect(client.closed).toBe(true)
  })

  it('reports a failed start with the stderr tail and closes', async () => {
    const upstream = new FakeUpstream()
    upstream.failStart = new Error('spawn npx ENOENT')
    const pooled = connection(upstream)

    await expect(pooled.attach().start()).rejects.toThrow('spawn npx ENOENT\nboom on stderr')
    expect(pooled.isClosed).toBe(true)
  })

  it('discards the connection after an expired HTTP session so a reconnect starts fresh', async () => {
    const upstream = new FakeUpstream()
    const pooled = connection(upstream)
    const lease = pooled.attach()
    await handshake(lease)
    const expired = new Error('session expired')
    expired.name = 'McpSessionExpiredError'
    upstream.failSend = expired

    await expect(lease.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).rejects.toThrow(
      'session expired',
    )
    await flush()

    expect(pooled.isClosed).toBe(true)
  })

  it('initializes for its own requests when no client has, and shows results to an observer', async () => {
    const upstream = new FakeUpstream((request) =>
      request.method === 'resources/read' ? { contents: [] } : { tools: [] },
    )
    const observeResult = vi.fn()
    const pooled = connection(upstream, { observeResult })

    await expect(pooled.request('resources/read', { uri: 'ui://app' })).resolves.toEqual({
      contents: [],
    })
    const lease = pooled.attach()
    await handshake(lease)
    await lease.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    await flush()

    expect(upstream.methods()).toEqual([
      'initialize',
      'notifications/initialized',
      'resources/read',
      'tools/list',
    ])
    expect(observeResult).toHaveBeenCalledWith('tools/list', undefined, { tools: [] })
  })
})
