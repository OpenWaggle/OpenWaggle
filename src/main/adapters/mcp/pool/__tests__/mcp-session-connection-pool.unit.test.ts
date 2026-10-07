import { describe, expect, it } from 'vitest'
import {
  MCP_IDLE_CLOSE_MS,
  type McpPoolClock,
  McpSessionConnectionPool,
} from '../mcp-session-connection-pool'
import { collect, FakeUpstream, flush, initializeRequest } from './fake-upstream'

class FakeClock implements McpPoolClock {
  now = 0
  private timers: { at: number; callback: () => void; cancelled: boolean }[] = []

  setTimeout(callback: () => void, delayMs: number) {
    const timer = { at: this.now + delayMs, callback, cancelled: false }
    this.timers.push(timer)
    return {
      cancel: () => {
        timer.cancelled = true
      },
    }
  }

  advance(ms: number) {
    this.now += ms
    const due = this.timers.filter((timer) => !timer.cancelled && timer.at <= this.now)
    this.timers = this.timers.filter((timer) => !due.includes(timer))
    for (const timer of due) timer.callback()
  }
}

function server(name: string, upstreams: FakeUpstream[], fingerprint = 'v1') {
  return {
    name,
    fingerprint,
    open: () => {
      const upstream = new FakeUpstream()
      upstreams.push(upstream)
      return { transport: upstream }
    },
  }
}

async function useServer(
  pool: McpSessionConnectionPool,
  sessionId: string,
  spec: ReturnType<typeof server>,
) {
  const lease = pool.lease(sessionId, spec)
  await lease.start()
  await lease.send(initializeRequest(1))
  await flush()
  await lease.close()
}

describe('MCP Session connection pool', () => {
  it('keeps a Session’s connection between Runs and closes it after five idle minutes', async () => {
    const clock = new FakeClock()
    const upstreams: FakeUpstream[] = []
    const pool = new McpSessionConnectionPool({ clock })

    const endFirst = pool.beginRun('s1')
    await useServer(pool, 's1', server('figma', upstreams))
    endFirst()
    clock.advance(MCP_IDLE_CLOSE_MS - 1)
    const endSecond = pool.beginRun('s1')
    await useServer(pool, 's1', server('figma', upstreams))
    clock.advance(MCP_IDLE_CLOSE_MS * 2)

    expect(upstreams).toHaveLength(1)
    expect(upstreams[0]?.closed).toBe(false)

    endSecond()
    clock.advance(MCP_IDLE_CLOSE_MS - 1)
    expect(upstreams[0]?.closed).toBe(false)
    clock.advance(1)
    await flush()

    expect(upstreams[0]?.closed).toBe(true)
    expect(pool.warmSessions()).toEqual([])
  })

  it('never shares a connection between Sessions', async () => {
    const upstreams: FakeUpstream[] = []
    const pool = new McpSessionConnectionPool({ clock: new FakeClock() })

    await useServer(pool, 'parent', server('playwright', upstreams))
    await useServer(pool, 'worker', server('playwright', upstreams))

    expect(upstreams).toHaveLength(2)
    expect(pool.warmSessions()).toEqual(['parent', 'worker'])
  })

  it('closes a Session’s connections at once when it is archived', async () => {
    const upstreams: FakeUpstream[] = []
    const pool = new McpSessionConnectionPool({ clock: new FakeClock() })
    await useServer(pool, 's1', server('a', upstreams))
    await useServer(pool, 's1', server('b', upstreams))
    await useServer(pool, 's2', server('a', upstreams))

    await pool.closeSession('s1')

    expect(upstreams.map((upstream) => upstream.closed)).toEqual([true, true, false])
    expect(pool.warmSessions()).toEqual(['s2'])
  })

  it('closes one server in every Session, for example after signing out of it', async () => {
    const upstreams: FakeUpstream[] = []
    const pool = new McpSessionConnectionPool({ clock: new FakeClock() })
    await useServer(pool, 's1', server('sentry', upstreams))
    await useServer(pool, 's1', server('fs', upstreams))
    await useServer(pool, 's2', server('sentry', upstreams))

    await pool.closeServer('sentry')

    expect(upstreams.map((upstream) => upstream.closed)).toEqual([true, false, true])
  })

  it('replaces a connection whose definition changed', async () => {
    const upstreams: FakeUpstream[] = []
    const pool = new McpSessionConnectionPool({ clock: new FakeClock() })

    await useServer(pool, 's1', server('a', upstreams, 'v1'))
    await useServer(pool, 's1', server('a', upstreams, 'v2'))

    expect(upstreams.map((upstream) => upstream.closed)).toEqual([true, false])
  })

  it('evicts the least recently used Session without a Run when too many are warm', async () => {
    const upstreams: FakeUpstream[] = []
    const pool = new McpSessionConnectionPool({ clock: new FakeClock(), maxWarmSessions: 2 })
    const endBusy = pool.beginRun('busy')
    await useServer(pool, 'busy', server('a', upstreams))
    await useServer(pool, 'idle', server('a', upstreams))
    await useServer(pool, 'busy', server('b', upstreams))

    await useServer(pool, 'new', server('a', upstreams))
    await flush()

    expect(pool.warmSessions()).toEqual(['busy', 'new'])
    expect(upstreams.map((upstream) => upstream.closed)).toEqual([false, true, false, false])
    endBusy()
  })

  it('closes everything when the Host stops', async () => {
    const upstreams: FakeUpstream[] = []
    const pool = new McpSessionConnectionPool({ clock: new FakeClock() })
    pool.beginRun('s1')
    await useServer(pool, 's1', server('a', upstreams))
    await useServer(pool, 's2', server('a', upstreams))

    await pool.closeAll()

    expect(upstreams.every((upstream) => upstream.closed)).toBe(true)
    expect(pool.warmSessions()).toEqual([])
  })

  it('reports each server’s clients, error and stderr for Settings', async () => {
    const pool = new McpSessionConnectionPool({ clock: new FakeClock() })
    const lease = pool.lease('s1', {
      name: 'a',
      fingerprint: 'v1',
      open: () => ({ transport: new FakeUpstream(), stderrTail: () => 'starting…' }),
    })
    collect(lease)
    await lease.start()

    expect(pool.status('s1')).toEqual([{ name: 'a', clients: 1, stderrTail: 'starting…' }])
  })
})
