import { describe, expect, it } from 'vitest'
import { McpSessionConnectionPool } from '../mcp-session-connection-pool'
import { FakeUpstream, flush } from './fake-upstream'

describe('a Run’s failed connection (review R5 P2-2)', () => {
  it('is reported once the leased server fails to start, and not before the lease', async () => {
    const pool = new McpSessionConnectionPool()
    pool.beginRun('s1')
    expect(pool.connectionFailed('s1', 'broken')).toBe(false)
    const lease = pool.lease('s1', {
      name: 'broken',
      fingerprint: 'v1',
      open: () => {
        const upstream = new FakeUpstream()
        upstream.failStart = new Error('command not found')
        return { transport: upstream }
      },
    })
    expect(pool.connectionFailed('s1', 'broken')).toBe(false)
    await lease.start().catch(() => undefined)
    await flush()
    expect(pool.connectionFailed('s1', 'broken')).toBe(true)
  })
})
