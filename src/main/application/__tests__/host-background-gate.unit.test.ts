import { describe, expect, it } from 'vitest'
import {
  HOST_BACKGROUND_CLIENT_SETTLE_MS,
  HOST_IDLE_SLIM_DELAY_MS,
  HostBackgroundGate,
  type HostBackgroundGateClock,
} from '../host-background-gate'

class FakeClock implements HostBackgroundGateClock {
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

const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

describe('Host background gate (A-F9, decision 4)', () => {
  it('is always open until the Session Host enables it', async () => {
    const gate = new HostBackgroundGate(new FakeClock())
    expect(gate.isOpen).toBe(true)
    await gate.whenOpen()
  })

  it('lets background work start only once a client has been attached a moment', async () => {
    const clock = new FakeClock()
    const gate = new HostBackgroundGate(clock)
    gate.enable()
    let started = false
    void gate.whenOpen().then(() => {
      started = true
    })
    clock.advance(60_000)
    await flush()
    expect(started).toBe(false)

    gate.clientAttached()
    clock.advance(HOST_BACKGROUND_CLIENT_SETTLE_MS - 1)
    await flush()
    expect(started).toBe(false)
    clock.advance(1)
    await flush()
    expect(started).toBe(true)
  })

  it('pauses background work and slims once the last client has left', async () => {
    const clock = new FakeClock()
    const gate = new HostBackgroundGate(clock)
    let slims = 0
    gate.onSlim(() => {
      slims += 1
    })
    gate.enable()
    const desktop = gate.clientAttached()
    const cli = gate.clientAttached()
    clock.advance(HOST_BACKGROUND_CLIENT_SETTLE_MS)
    expect(gate.isOpen).toBe(true)

    cli()
    clock.advance(HOST_IDLE_SLIM_DELAY_MS)
    expect(slims).toBe(0)
    desktop()
    expect(gate.isOpen).toBe(false)
    clock.advance(HOST_IDLE_SLIM_DELAY_MS)
    expect(slims).toBe(1)
    clock.advance(HOST_IDLE_SLIM_DELAY_MS * 10)
    expect(slims).toBe(1)
  })

  it('does not slim when a window reload reconnects in time', () => {
    const clock = new FakeClock()
    const gate = new HostBackgroundGate(clock)
    let slims = 0
    gate.onSlim(() => {
      slims += 1
    })
    gate.enable()
    gate.clientAttached()()
    clock.advance(HOST_IDLE_SLIM_DELAY_MS - 1)
    gate.clientAttached()
    clock.advance(HOST_IDLE_SLIM_DELAY_MS * 10)
    expect(slims).toBe(0)
  })
})

describe('Session Host clients and the background gate', () => {
  it('counts each authenticated client the Host liveness admits', async () => {
    const { SessionHostLiveness } = await import('../session-host-liveness')
    const { hostBackgroundGate } = await import('../host-background-gate')
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 1_000,
      requestShutdown: () => {},
    })
    const before = hostBackgroundGate.attachedClients
    const release = liveness.acquire('client')
    const run = liveness.acquire('run')
    expect(hostBackgroundGate.attachedClients).toBe(before + 1)
    release()
    run()
    expect(hostBackgroundGate.attachedClients).toBe(before)
    liveness.close()
  })
})
