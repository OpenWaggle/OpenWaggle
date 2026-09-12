import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTerminalProcessPollScheduler } from '../terminal-process-poll-scheduler'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('terminal metadata polling schedule', () => {
  it('backs off rejected probes without leaking an unhandled rejection', async () => {
    const poll = vi.fn(async () => true).mockRejectedValueOnce(new Error('probe crashed'))
    const scheduler = makeTerminalProcessPollScheduler(poll)
    scheduler.update(true)
    await vi.advanceTimersByTimeAsync(1_999)
    expect(poll).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(poll).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(poll).toHaveBeenCalledTimes(3)
    scheduler.update(false)
  })

  it('backs off failed probes to a minute and restores one-second polling on recovery', async () => {
    const poll = vi.fn(async () => false)
    const scheduler = makeTerminalProcessPollScheduler(poll)
    scheduler.update(true)
    await vi.advanceTimersByTimeAsync(0)
    for (const delay of [2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]) {
      const calls = poll.mock.calls.length
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(poll).toHaveBeenCalledTimes(calls)
      await vi.advanceTimersByTimeAsync(1)
      expect(poll).toHaveBeenCalledTimes(calls + 1)
    }
    poll.mockResolvedValue(true)
    await vi.advanceTimersByTimeAsync(60_000)
    const calls = poll.mock.calls.length
    await vi.advanceTimersByTimeAsync(1_000)
    expect(poll).toHaveBeenCalledTimes(calls + 1)
    scheduler.update(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('never overlaps a slow probe or schedules a completion after shutdown', async () => {
    let finish: ((success: boolean) => void) | undefined
    const poll = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve
        }),
    )
    const scheduler = makeTerminalProcessPollScheduler(poll)
    scheduler.update(true)
    scheduler.update(true, true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(poll).toHaveBeenCalledOnce()
    scheduler.update(false)
    finish?.(true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(poll).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})
