import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { McpSessionConnectionPool } from '../mcp-session-connection-pool'
import { MCP_IDLE_CLOSE_MS, type McpPoolClock } from '../mcp-session-connection-pool-types'
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
  spec: ReturnType<typeof server> & {
    readonly identity?: string
    readonly projectPath?: string
  },
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

  it('closes one server identity in every Session, for example after signing out of it', async () => {
    const upstreams: FakeUpstream[] = []
    const pool = new McpSessionConnectionPool({ clock: new FakeClock() })
    await useServer(pool, 's1', { ...server('sentry', upstreams), identity: 'id-sentry' })
    await useServer(pool, 's1', { ...server('fs', upstreams), identity: 'id-fs' })
    await useServer(pool, 's2', { ...server('sentry', upstreams), identity: 'id-sentry' })
    // Another project's server that happens to share the name is a different server.
    await useServer(pool, 's3', { ...server('sentry', upstreams), identity: 'id-other-sentry' })

    await pool.closeServerIdentity('id-sentry')

    expect(upstreams.map((upstream) => upstream.closed)).toEqual([true, false, true, false])
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

  it('tells Settings a warm connection’s state without using it or keeping it warm', async () => {
    const upstreams: FakeUpstream[] = []
    const pool = new McpSessionConnectionPool({ clock: new FakeClock() })
    const figma = { ...server('figma', upstreams), identity: 'mcp-server:figma' }
    await useServer(pool, 'run', figma)
    const opening = pool.lease('other', {
      ...server('docs', upstreams),
      identity: 'mcp-server:docs',
    })
    await opening.start()
    const sent = upstreams.map((upstream) => upstream.received.length)
    const recency = pool.warmSessions()

    expect(pool.connectionStates('mcp-server:figma', null)).toEqual([{ ready: true }])
    expect(pool.connectionStates('mcp-server:docs', null)).toEqual([{ ready: false }])
    expect(pool.connectionStates('mcp-server:unknown', null)).toEqual([])
    expect(upstreams.map((upstream) => upstream.received.length)).toEqual(sent)
    expect(pool.warmSessions()).toEqual(recency)

    upstreams[0]?.crash()
    expect(pool.connectionStates('mcp-server:figma', null)).toEqual([])
  })

  it("tells a project only its own Sessions' connections, as each Session has its own", async () => {
    const upstreams: FakeUpstream[] = []
    const pool = new McpSessionConnectionPool({ clock: new FakeClock() })
    const docs = { ...server('docs', upstreams), identity: 'mcp-server:docs' }
    await useServer(pool, 'in-beta', { ...docs, projectPath: '/work/beta' })

    expect(pool.connectionStates('mcp-server:docs', '/work/beta')).toEqual([{ ready: true }])
    expect(pool.connectionStates('mcp-server:docs', '/work/beta/')).toEqual([{ ready: true }])
    // Another project's Settings would connect its own Session, so it is not connected there.
    expect(pool.connectionStates('mcp-server:docs', '/work/alpha')).toEqual([])
    expect(pool.connectionStates('mcp-server:docs', null)).toEqual([])
  })

  it("matches a Session's project however its folder is spelled, such as through a link", async () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'ow-mcp-pool-project-')))
    const real = path.join(root, 'real')
    mkdirSync(real)
    symlinkSync(real, path.join(root, 'linked'))
    const upstreams: FakeUpstream[] = []
    const pool = new McpSessionConnectionPool({ clock: new FakeClock() })
    const docs = { ...server('docs', upstreams), identity: 'mcp-server:docs' }
    // The Session's Run uses the link; Settings sends the real path.
    await useServer(pool, 'in-linked', { ...docs, projectPath: path.join(root, 'linked') })

    expect(pool.connectionStates('mcp-server:docs', real)).toEqual([{ ready: true }])
    rmSync(root, { recursive: true, force: true })
  })

  it('closes one server of a Session and refuses its Run leases until the next Run', async () => {
    const upstreams: FakeUpstream[] = []
    const pool = new McpSessionConnectionPool()
    const docs = { ...server('docs', upstreams), identity: 'id-docs', projectPath: '/p' }
    const endRun = pool.beginRun('s1')
    await useServer(pool, 's1', docs)
    await useServer(pool, 's1', server('lint', upstreams))

    expect(pool.serverConnections()).toEqual([
      {
        sessionId: 's1',
        name: 'docs',
        identity: 'id-docs',
        projectPath: '/p',
        fromExtension: false,
      },
      {
        sessionId: 's1',
        name: 'lint',
        identity: undefined,
        projectPath: null,
        fromExtension: false,
      },
    ])
    await pool.closeServer('s1', 'docs')

    expect(upstreams[0]?.closed).toBe(true)
    expect(upstreams[1]?.closed).toBe(false)
    expect(() => pool.lease('s1', docs)).toThrow('turned off')
    endRun()
    pool.beginRun('s1')
    expect(() => pool.lease('s1', docs)).not.toThrow()
  })

  it('lets a retiring connection finish its requests while a new lease opens a fresh one', async () => {
    const upstreams: FakeUpstream[] = []
    const pool = new McpSessionConnectionPool()
    const spec = server('docs', upstreams)
    const first = pool.lease('s1', spec)
    const client = collect(first)
    await first.start()
    await first.send(initializeRequest(1))
    await first.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    await flush()
    await first.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'slow' } })
    const [slow] = upstreams[0]?.requests('tools/call') ?? []
    const expired = new Error('session expired')
    expired.name = 'McpSessionExpiredError'
    if (upstreams[0]) upstreams[0].failSend = expired
    await expect(first.send({ jsonrpc: '2.0', id: 3, method: 'tools/list' })).rejects.toThrow()
    await flush()

    // The next Run's lease gets a new connection; the retiring one is not cut short.
    const second = pool.lease('s1', spec)
    await second.start()
    expect(upstreams).toHaveLength(2)
    expect(upstreams[0]?.closed).toBe(false)
    upstreams[0]?.push({ jsonrpc: '2.0', id: slow?.id ?? 0, result: { content: [] } })
    await flush()

    expect(client.messages).toContainEqual({ jsonrpc: '2.0', id: 2, result: { content: [] } })
    expect(upstreams[0]?.closed).toBe(true)
  })

  it("refuses a running Run's leases once its Session's connections were closed", async () => {
    const upstreams: FakeUpstream[] = []
    const pool = new McpSessionConnectionPool()
    const docs = server('docs', upstreams)
    const endRun = pool.beginRun('s1')
    await useServer(pool, 's1', docs)

    // Switched off mid-Run: Pi's client must not reconnect through the Run's transport factory.
    await pool.closeSession('s1')
    expect(() => pool.lease('s1', docs)).toThrow('closed')
    endRun()
    pool.beginRun('s1')
    expect(() => pool.lease('s1', docs)).not.toThrow()

    await pool.closeAll()
    expect(() => pool.lease('s1', docs)).toThrow('closed')
    expect(() => pool.lease('s2', docs)).toThrow('closed')
  })

  it('keeps judging a server the Run leased after its connection crashed, so it can be turned off', async () => {
    const upstreams: FakeUpstream[] = []
    const pool = new McpSessionConnectionPool()
    const docs = { ...server('docs', upstreams), identity: 'id-docs', projectPath: '/p' }
    pool.beginRun('s1')
    await useServer(pool, 's1', docs)
    upstreams[0]?.crash()
    await flush()

    // Not warm any more, but the Run's Pi client would reopen it on its next call.
    expect(pool.serverConnections()).toEqual([
      {
        sessionId: 's1',
        name: 'docs',
        identity: 'id-docs',
        projectPath: '/p',
        fromExtension: false,
      },
    ])
    await pool.closeServer('s1', 'docs')

    expect(() => pool.lease('s1', docs)).toThrow('turned off')
  })

  it('refuses an MCP App connection for a Session whose connections were closed', async () => {
    const upstreams: FakeUpstream[] = []
    const pool = new McpSessionConnectionPool()
    const docs = server('docs', upstreams)

    // An App request that started before the Session was archived or switched MCP off.
    await pool.closeSession('s1')
    expect(() => pool.connectionFor('s1', docs)).toThrow('closed')
    await pool.closeAll()
    expect(() => pool.connectionFor('s2', docs)).toThrow('closed')
    expect(upstreams).toHaveLength(0)
  })
})

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
