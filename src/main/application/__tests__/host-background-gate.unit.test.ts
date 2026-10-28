import { describe, expect, it } from 'vitest'
import {
  HOST_BACKGROUND_CLIENT_SETTLE_MS,
  HOST_BACKGROUND_MAX_DEFERRAL_MS,
  HOST_FOREGROUND_COMMAND_HOLD_MS,
  HOST_FOREGROUND_QUIET_MS,
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

  elapsedMs() {
    return this.now
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

describe('Host background work gives way to client commands (W12)', () => {
  function quietTracker(gate: HostBackgroundGate) {
    const state = { resolved: false }
    void gate.whenForegroundQuiet().then(() => {
      state.resolved = true
    })
    return state
  }

  it('never waits before the Session Host enables the gate', async () => {
    const gate = new HostBackgroundGate(new FakeClock())
    gate.foregroundStarted()
    const quiet = quietTracker(gate)
    await flush()
    expect(quiet.resolved).toBe(true)
  })

  it('waits while a command is in flight and until the clients were quiet a moment', async () => {
    const clock = new FakeClock()
    const gate = new HostBackgroundGate(clock)
    gate.enable()
    const idle = quietTracker(gate)
    await flush()
    expect(idle.resolved).toBe(true)

    const end = gate.foregroundStarted()
    const quiet = quietTracker(gate)
    clock.advance(HOST_FOREGROUND_QUIET_MS * 4)
    await flush()
    expect(quiet.resolved).toBe(false)

    end()
    clock.advance(HOST_FOREGROUND_QUIET_MS - 1)
    await flush()
    expect(quiet.resolved).toBe(false)
    // A dependent request arrives in the gap and answers; the quiet moment starts again.
    gate.foregroundStarted()()
    clock.advance(HOST_FOREGROUND_QUIET_MS - 1)
    await flush()
    expect(quiet.resolved).toBe(false)
    clock.advance(1)
    await flush()
    expect(quiet.resolved).toBe(true)
    expect(gate.foregroundCommandCount).toBe(0)
  })

  it('waits at most the maximum deferral, so busy clients cannot starve background work', async () => {
    const clock = new FakeClock()
    const gate = new HostBackgroundGate(clock)
    gate.enable()
    const end = gate.foregroundStarted()
    const quiet = quietTracker(gate)
    end()
    const step = HOST_FOREGROUND_QUIET_MS / 2
    for (let elapsed = 0; elapsed < HOST_BACKGROUND_MAX_DEFERRAL_MS - step; elapsed += step) {
      gate.foregroundStarted()()
      clock.advance(step)
    }
    await flush()
    expect(quiet.resolved).toBe(false)
    clock.advance(step)
    await flush()
    expect(quiet.resolved).toBe(true)
  })

  it('lets a command that has been in flight for long stop holding background work back', async () => {
    const clock = new FakeClock()
    const gate = new HostBackgroundGate(clock)
    gate.enable()
    gate.foregroundStarted()
    clock.advance(HOST_FOREGROUND_COMMAND_HOLD_MS + HOST_FOREGROUND_QUIET_MS)
    const quiet = quietTracker(gate)
    await flush()
    expect(quiet.resolved).toBe(true)
    expect(gate.foregroundCommandCount).toBe(1)
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
