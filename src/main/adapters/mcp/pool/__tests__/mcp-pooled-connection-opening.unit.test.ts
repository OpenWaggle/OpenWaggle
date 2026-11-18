import { describe, expect, it, vi } from 'vitest'
import type { McpUpstream } from '../mcp-connection-support'
import { McpPooledConnection } from '../mcp-pooled-connection'
import { FakeUpstream, flush } from './fake-upstream'

describe('a pooled MCP connection closed while its upstream opens', () => {
  it('still releases the upstream once it has opened', async () => {
    const upstream = new FakeUpstream()
    const closeHeld = vi.fn(async () => undefined)
    const opened = Promise.withResolvers<McpUpstream>()
    const pooled = new McpPooledConnection({
      serverName: 'fake',
      // Opening first reads what it needs, such as vault secrets.
      open: () => opened.promise,
      onClosed: () => {},
    })
    const lease = pooled.attach()
    const starting = lease.start().catch(() => undefined)
    await flush()

    await pooled.close()
    opened.resolve({ transport: upstream, close: closeHeld })
    await starting
    await flush()

    expect(upstream.closed).toBe(true)
    expect(closeHeld).toHaveBeenCalledOnce()
  })
})
