import { describe, expect, it } from 'vitest'
import { McpPooledConnection } from '../mcp-pooled-connection'
import { FakeUpstream, flush, initializeRequest } from './fake-upstream'

function connection(upstream: FakeUpstream, onClosed: () => void) {
  return new McpPooledConnection({
    serverName: 'fake',
    open: () => ({ transport: upstream, stderrTail: () => '' }),
    onClosed,
  })
}

async function handshake(lease: ReturnType<McpPooledConnection['attach']>, id = 1) {
  await lease.start()
  await lease.send(initializeRequest(id))
  await lease.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  await flush()
}

/** A connection retiring after an expired HTTP session while `first` still has a request open. */
async function retiringWithOpenRequest() {
  const upstream = new FakeUpstream()
  const state = { closed: false }
  const pooled = connection(upstream, () => {
    state.closed = true
  })
  const first = pooled.attach()
  const second = pooled.attach()
  await handshake(first)
  await handshake(second, 2)
  await first.send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'slow' } })
  const expired = new Error('session expired')
  expired.name = 'McpSessionExpiredError'
  upstream.failSend = expired
  await expect(second.send({ jsonrpc: '2.0', id: 6, method: 'tools/list' })).rejects.toThrow()
  upstream.failSend = undefined
  await flush()
  return { state, pooled, first }
}

describe('a retiring pooled MCP connection', () => {
  it('closes as soon as the client cancels its last open request', async () => {
    const { state, pooled, first } = await retiringWithOpenRequest()
    // Retiring: no new request, but the open one may still settle.
    expect(pooled.isClosed).toBe(true)
    expect(state.closed).toBe(false)

    await first.send({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: 5 },
    })
    await flush()

    // Not after the 30 s grace: nothing is left to wait for.
    expect(state.closed).toBe(true)
  })

  it('closes as soon as the client with the last open request detaches', async () => {
    const { state, first } = await retiringWithOpenRequest()

    await first.close()
    await flush()

    expect(state.closed).toBe(true)
  })
})
