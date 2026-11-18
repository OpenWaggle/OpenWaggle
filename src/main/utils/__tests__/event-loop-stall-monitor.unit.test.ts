import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startEventLoopStallMonitor } from '../event-loop-stall-monitor'

const INTERVAL_MS = 250

describe('event loop stall monitor', () => {
  let clock = 0
  const now = () => clock

  beforeEach(() => {
    vi.useFakeTimers()
    clock = 0
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** One sampler tick that the loop delivered `lateByMs` after it was due. */
  function tick(lateByMs = 0) {
    clock += INTERVAL_MS + lateByMs
    vi.advanceTimersByTime(INTERVAL_MS)
  }

  function start(describeContext?: () => object) {
    const logger = { warn: vi.fn() }
    const stop = startEventLoopStallMonitor({
      logger,
      message: 'stalled',
      now,
      sampleIntervalMs: INTERVAL_MS,
      stallThresholdMs: 1_000,
      minReportIntervalMs: 10_000,
      ...(describeContext ? { describe: describeContext } : {}),
    })
    return { logger, stop }
  }

  it('stays quiet while the loop keeps up, and reports a stall with its context', () => {
    const { logger, stop } = start(() => ({ inflightCommandCount: 2 }))
    for (let index = 0; index < 20; index += 1) tick(40)
    expect(logger.warn).not.toHaveBeenCalled()

    tick(2_500)
    expect(logger.warn).toHaveBeenCalledWith('stalled', {
      stalledMs: 2_500,
      suppressedStalls: 0,
      longestSuppressedMs: 0,
      inflightCommandCount: 2,
    })
    stop()
  })

  it('folds stalls inside the report interval into the next report', () => {
    const { logger, stop } = start(() => ({ inflightCommandCount: 1 }))
    tick(1_200)
    tick(3_000)
    tick(1_500)
    tick(2_000)
    expect(logger.warn).toHaveBeenCalledOnce()

    // The first report was at 1.45 s and this stall ends at 11.45 s, so it carries the others.
    tick(2_500)
    expect(logger.warn).toHaveBeenCalledTimes(2)
    expect(logger.warn).toHaveBeenLastCalledWith('stalled', {
      stalledMs: 2_500,
      suppressedStalls: 3,
      longestSuppressedMs: 3_000,
      inflightCommandCount: 1,
    })
    stop()
  })

  it('summarizes held-back stalls once the report interval passes without another', () => {
    const { logger, stop } = start(() => ({ inflightCommandCount: 1 }))
    tick(1_200)
    tick(3_000)
    tick(1_500)
    expect(logger.warn).toHaveBeenCalledOnce()

    // The first report was at 1.45 s and the third stall ended at 6.45 s; 20 quiet ticks later
    // the clock reaches 11.45 s, one full report interval after the first report.
    for (let index = 0; index < 19; index += 1) tick()
    expect(logger.warn).toHaveBeenCalledOnce()
    tick()
    expect(logger.warn).toHaveBeenCalledTimes(2)
    expect(logger.warn).toHaveBeenLastCalledWith('stalled', {
      suppressedStalls: 2,
      longestSuppressedMs: 3_000,
    })

    // Nothing is pending afterwards, so quiet ticks stay quiet.
    for (let index = 0; index < 60; index += 1) tick()
    expect(logger.warn).toHaveBeenCalledTimes(2)
    stop()
  })

  it('still reports when describing the context fails', () => {
    const { logger, stop } = start(() => {
      throw new Error('context unavailable')
    })
    tick(2_000)
    expect(logger.warn).toHaveBeenCalledWith('stalled', {
      stalledMs: 2_000,
      suppressedStalls: 0,
      longestSuppressedMs: 0,
      describeError: 'context unavailable',
    })
    stop()
  })

  it('stops sampling once released', () => {
    const { logger, stop } = start()
    stop()
    tick(5_000)
    expect(logger.warn).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
