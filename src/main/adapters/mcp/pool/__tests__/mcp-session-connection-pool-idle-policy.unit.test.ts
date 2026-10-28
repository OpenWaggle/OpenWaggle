import { describe, expect, it } from 'vitest'
import {
  settledWorkerIdleCloseMs,
  settledWorkerIdleClosePolicy,
} from '../../../../mcp-settled-worker-idle-policy'
import { McpSessionConnectionPool } from '../mcp-session-connection-pool'
import {
  MCP_IDLE_CLOSE_MS,
  MCP_MAX_WARM_SESSIONS,
  MCP_SETTLED_WORKER_IDLE_CLOSE_MS,
  type McpPoolClock,
} from '../mcp-session-connection-pool-types'
import { FakeUpstream, flush, initializeRequest } from './fake-upstream'

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

function server(upstreams: FakeUpstream[]) {
  return {
    name: 'figma',
    fingerprint: 'v1',
    open: () => {
      const upstream = new FakeUpstream()
      upstreams.push(upstream)
      return { transport: upstream }
    },
  }
}

async function runOnce(pool: McpSessionConnectionPool, sessionId: string, ups: FakeUpstream[]) {
  const end = pool.beginRun(sessionId)
  const lease = pool.lease(sessionId, server(ups))
  await lease.start()
  await lease.send(initializeRequest(1))
  await flush()
  await lease.close()
  end()
  await flush()
}

describe('MCP pool idle policy (D1.1)', () => {
  it('keeps at most three Sessions warm by default', async () => {
    expect(MCP_MAX_WARM_SESSIONS).toBe(3)
    const upstreams: FakeUpstream[] = []
    const pool = new McpSessionConnectionPool({ clock: new FakeClock() })
    for (const id of ['a', 'b', 'c', 'd']) await runOnce(pool, id, upstreams)
    await flush()
    expect(pool.warmSessions()).toEqual(['b', 'c', 'd'])
    expect(upstreams.map((upstream) => upstream.closed)).toEqual([true, false, false, false])
  })

  it('closes a settled Worker one minute after its Run, other Sessions after five', async () => {
    const clock = new FakeClock()
    const upstreams: FakeUpstream[] = []
    const pool = new McpSessionConnectionPool({
      clock,
      idleCloseMsFor: (id) => (id === 'worker' ? MCP_SETTLED_WORKER_IDLE_CLOSE_MS : undefined),
    })
    await runOnce(pool, 'worker', upstreams)
    await runOnce(pool, 'queen', upstreams)

    clock.advance(MCP_SETTLED_WORKER_IDLE_CLOSE_MS)
    await flush()
    expect(upstreams.map((upstream) => upstream.closed)).toEqual([true, false])

    clock.advance(MCP_IDLE_CLOSE_MS)
    await flush()
    expect(upstreams.map((upstream) => upstream.closed)).toEqual([true, true])
  })

  it('keeps a Worker’s servers while a new Run started before the policy answered', async () => {
    const clock = new FakeClock()
    const upstreams: FakeUpstream[] = []
    let answer: (value: number) => void = () => undefined
    const pool = new McpSessionConnectionPool({
      clock,
      idleCloseMsFor: () =>
        new Promise<number>((resolve) => {
          answer = resolve
        }),
    })
    await runOnce(pool, 'worker', upstreams)
    const end = pool.beginRun('worker')
    answer(MCP_SETTLED_WORKER_IDLE_CLOSE_MS)
    await flush()
    clock.advance(MCP_IDLE_CLOSE_MS * 2)
    await flush()
    expect(upstreams[0]?.closed).toBe(false)
    end()
  })

  it('treats review, accepted and cancelled Delegations as settled', () => {
    expect(settledWorkerIdleCloseMs('ready_for_review')).toBe(MCP_SETTLED_WORKER_IDLE_CLOSE_MS)
    expect(settledWorkerIdleCloseMs('accepted')).toBe(MCP_SETTLED_WORKER_IDLE_CLOSE_MS)
    expect(settledWorkerIdleCloseMs('cancelled')).toBe(MCP_SETTLED_WORKER_IDLE_CLOSE_MS)
    expect(settledWorkerIdleCloseMs('working')).toBeUndefined()
    expect(settledWorkerIdleCloseMs('revision_requested')).toBeUndefined()
    expect(settledWorkerIdleCloseMs(null)).toBeUndefined()
  })

  it('reads the Delegation state through the port it is given (review R5 P3-6)', async () => {
    const states = new Map([['worker', 'accepted' as const]])
    const policy = settledWorkerIdleClosePolicy(async (sessionId) => states.get(sessionId) ?? null)

    expect(await policy('worker')).toBe(MCP_SETTLED_WORKER_IDLE_CLOSE_MS)
    expect(await policy('queen')).toBeUndefined()
  })
})

describe('MCP pool without clients (decision 4)', () => {
  it('closes idle Sessions’ servers at once and keeps those of running Runs', async () => {
    const upstreams: FakeUpstream[] = []
    const pool = new McpSessionConnectionPool({ clock: new FakeClock() })
    await runOnce(pool, 'idle', upstreams)
    const end = pool.beginRun('busy')
    const lease = pool.lease('busy', server(upstreams))
    await lease.start()
    await lease.send(initializeRequest(1))
    await flush()

    await pool.closeIdleSessions()

    expect(upstreams.map((upstream) => upstream.closed)).toEqual([true, false])
    expect(pool.warmSessions()).toEqual(['busy'])
    // An idle close refuses nothing: the idle Session's next Run reconnects.
    await runOnce(pool, 'idle', upstreams)
    expect(upstreams).toHaveLength(3)
    end()
  })
})
