import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalSessionHandshakeDeadline } from '../local-session-handshake-deadline'

const TIMEOUT_MS = 1_000

describe('Local Session handshake deadline', () => {
  /** The deadline's view of the clock; a stall advances it without running timers. */
  let clock = 0
  const now = () => clock

  beforeEach(() => {
    vi.useFakeTimers()
    clock = 0
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** Runs the pending deadline timer `lateByMs` after it was due, then its follow-up check. */
  function elapse(lateByMs = 0) {
    clock += TIMEOUT_MS + lateByMs
    vi.advanceTimersByTime(TIMEOUT_MS)
    vi.runAllTicks()
    // The verdict waits for setImmediate, after pending socket input has been read.
    vi.advanceTimersToNextTimer()
  }

  function start() {
    const expire = vi.fn()
    const deadline = new LocalSessionHandshakeDeadline(TIMEOUT_MS, expire, now)
    return { deadline, expire }
  }

  it('expires an on-time deadline after pending input could be read', () => {
    const { deadline, expire } = start()
    clock += TIMEOUT_MS
    vi.advanceTimersByTime(TIMEOUT_MS)
    expect(expire).not.toHaveBeenCalled()
    expect(deadline.expired).toBe(false)

    vi.advanceTimersToNextTimer()
    expect(expire).toHaveBeenCalledOnce()
    expect(deadline.expired).toBe(true)
  })

  it('re-arms once per late fire, then expires once the Host keeps stalling', () => {
    const { deadline, expire } = start()
    for (let lateFire = 0; lateFire < 3; lateFire += 1) {
      elapse(5_000)
      expect(expire).not.toHaveBeenCalled()
    }
    // A fourth late fire is not forgiven: the handshake has had four full periods already.
    elapse(5_000)
    expect(expire).toHaveBeenCalledOnce()
    expect(deadline.expired).toBe(true)
  })

  it('treats a stall between the timer and the verdict as a late fire', () => {
    const { expire } = start()
    clock += TIMEOUT_MS
    vi.advanceTimersByTime(TIMEOUT_MS)
    // Another timer blocks the loop before the verdict runs.
    clock += 5_000
    vi.advanceTimersToNextTimer()
    expect(expire).not.toHaveBeenCalled()

    elapse()
    expect(expire).toHaveBeenCalledOnce()
  })

  it('gives a received hello one more period to authenticate', () => {
    const { deadline, expire } = start()
    deadline.markHelloReceived()
    elapse()
    expect(expire).not.toHaveBeenCalled()

    elapse()
    expect(expire).toHaveBeenCalledOnce()
  })

  it('never expires once cleared, including between the timer and its verdict', () => {
    const { deadline, expire } = start()
    clock += TIMEOUT_MS
    vi.advanceTimersByTime(TIMEOUT_MS)
    deadline.clear()
    vi.runAllTimers()

    expect(expire).not.toHaveBeenCalled()
    expect(deadline.expired).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})
