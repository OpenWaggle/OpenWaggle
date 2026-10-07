import { describe, expect, it, vi } from 'vitest'
import { McpPooledConnection } from '../mcp-pooled-connection'
import { collect, FakeUpstream, flush, initializeRequest } from './fake-upstream'

function connection(upstream: FakeUpstream, close = vi.fn(async () => undefined)) {
  return new McpPooledConnection({
    serverName: 'fake',
    open: () => ({ transport: upstream, close }),
    onClosed: () => {},
  })
}

async function handshake(lease: ReturnType<McpPooledConnection['attach']>, id = 1) {
  await lease.start()
  await lease.send(initializeRequest(id))
  await lease.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  await flush()
}

function sessionExpired() {
  const expired = new Error('session expired')
  expired.name = 'McpSessionExpiredError'
  return expired
}

describe('a pooled connection that has to go away', () => {
  it('lets other in-flight requests settle after an expired session, then closes', async () => {
    const upstream = new FakeUpstream()
    const pooled = connection(upstream)
    const a = pooled.attach()
    const aClient = collect(a)
    const b = pooled.attach()
    await handshake(a)
    await handshake(b, 5)
    await a.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'slow' } })
    const [slow] = upstream.requests('tools/call')

    upstream.failSend = sessionExpired()
    await expect(b.send({ jsonrpc: '2.0', id: 6, method: 'tools/list' })).rejects.toThrow(
      'session expired',
    )
    await flush()

    // No new client may use it, but the request already sent still gets its answer.
    expect(pooled.isClosed).toBe(true)
    expect(() => pooled.attach()).toThrow()
    expect(upstream.closed).toBe(false)
    upstream.push({ jsonrpc: '2.0', id: slow?.id ?? 0, result: { content: [] } })
    await flush()

    expect(aClient.messages).toContainEqual({ jsonrpc: '2.0', id: 2, result: { content: [] } })
    expect(upstream.closed).toBe(true)
  })

  it('answers every request still open with an error when it closes', async () => {
    const upstream = new FakeUpstream()
    const pooled = connection(upstream)
    const lease = pooled.attach()
    const client = collect(lease)
    await handshake(lease)
    await lease.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'slow' } })

    await pooled.close()

    expect(client.messages).toContainEqual(
      expect.objectContaining({ id: 2, error: expect.objectContaining({ code: -32603 }) }),
    )
  })

  it("releases the upstream's own resources, such as its fetch, when it closes", async () => {
    const closed = vi.fn(async () => undefined)
    const pooled = connection(new FakeUpstream(), closed)
    await handshake(pooled.attach())
    const crashed = new FakeUpstream()
    const crashedClosed = vi.fn(async () => undefined)
    await handshake(connection(crashed, crashedClosed).attach())

    await pooled.close()
    await pooled.close()
    crashed.crash()
    await flush()

    expect(closed).toHaveBeenCalledOnce()
    expect(crashedClosed).toHaveBeenCalledOnce()
  })
})
