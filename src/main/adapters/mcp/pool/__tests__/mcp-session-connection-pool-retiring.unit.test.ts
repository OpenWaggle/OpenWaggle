import { describe, expect, it } from 'vitest'
import { McpSessionConnectionPool } from '../mcp-session-connection-pool'
import { FakeUpstream, flush, initializeRequest } from './fake-upstream'

function server(upstreams: FakeUpstream[]) {
  return {
    name: 'docs',
    fingerprint: 'v1',
    open: () => {
      const upstream = new FakeUpstream()
      upstreams.push(upstream)
      return { transport: upstream }
    },
  }
}

/** A connection that retired after an expired HTTP session, and the one that replaced it. */
async function replacedWhileRetiring(pool: McpSessionConnectionPool, upstreams: FakeUpstream[]) {
  const docs = server(upstreams)
  const waiting = pool.lease('s1', docs)
  await waiting.start()
  await waiting.send(initializeRequest(1))
  await flush()
  // Still open: it keeps the old connection retiring instead of closed.
  await waiting.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'slow' } })
  const expired = new Error('session expired')
  expired.name = 'McpSessionExpiredError'
  const first = upstreams[0]
  if (!first) throw new Error('no upstream')
  first.failSend = expired
  await waiting.send({ jsonrpc: '2.0', id: 3, method: 'tools/list' }).catch(() => undefined)
  first.failSend = undefined
  await flush()
  const next = pool.lease('s1', docs)
  await next.start()
  await flush()
  expect(upstreams).toHaveLength(2)
  return first
}

describe('a retiring MCP connection another one replaced', () => {
  it('closes with its Session', async () => {
    const upstreams: FakeUpstream[] = []
    const pool = new McpSessionConnectionPool()
    const retiring = await replacedWhileRetiring(pool, upstreams)

    await pool.closeSession('s1')

    expect(retiring.closed).toBe(true)
  })

  it('closes when the Host stops', async () => {
    const upstreams: FakeUpstream[] = []
    const pool = new McpSessionConnectionPool()
    const retiring = await replacedWhileRetiring(pool, upstreams)

    await pool.closeAll()

    expect(retiring.closed).toBe(true)
  })
})
