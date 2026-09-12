import { fromPartial } from '@total-typescript/shoehorn'
import type { IPty } from 'node-pty'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LiveTerminalProcess } from '../terminal-records'
import {
  retryLiveTerminalTtySignal,
  signalLiveTerminalTtyMembers,
  terminalTtySignalResolvedRoot,
} from '../terminal-tty-signal'

function subject(result: number | null = 1) {
  const socket = { destroyed: false, closed: false }
  const pty = fromPartial<IPty>({ pid: 12_345 })
  Reflect.set(pty, '_socket', socket)
  const signalTtyMembers = vi.fn((_force: boolean) => result)
  const live = fromPartial<LiveTerminalProcess>({
    pty,
    pid: 12_345,
    signalTtyMembers,
  })
  return { live, signalTtyMembers, socket }
}

describe('signalLiveTerminalTtyMembers', () => {
  afterEach(() => vi.useRealTimers())

  it.each([
    { count: 3, expected: 'signaled' },
    { count: 0, expected: 'no-match' },
    { count: -2, expected: 'partial' },
    { count: -1, expected: 'unavailable' },
    { count: null, expected: 'unavailable' },
  ] as const)('maps native result $count to $expected', ({ count, expected }) => {
    const target = subject(count)

    expect(signalLiveTerminalTtyMembers(target.live, false)).toBe(expected)
    expect(target.signalTtyMembers).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('does not signal after the exact PTY descriptor closes', () => {
    const target = subject()
    target.socket.destroyed = true

    expect(signalLiveTerminalTtyMembers(target.live, false)).toBe('unavailable')
    expect(target.signalTtyMembers).not.toHaveBeenCalled()
  })

  it('can force remaining tty members after the root has already exited', () => {
    const target = subject()

    expect(signalLiveTerminalTtyMembers(target.live, true)).toBe('signaled')
    expect(target.signalTtyMembers).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('is unavailable when the native descriptor-bound callback is absent', () => {
    const target = subject()
    const live = fromPartial<LiveTerminalProcess>({ pty: target.live.pty, pid: 12_345 })

    expect(signalLiveTerminalTtyMembers(live, false)).toBe('unavailable')
  })

  it('retries a side-effect-free native miss while a new root attaches', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const target = subject(-1)
    target.signalTtyMembers.mockReturnValueOnce(-1).mockReturnValueOnce(-1).mockReturnValue(2)

    const result = retryLiveTerminalTtySignal(target.live, true, 1_010)
    await vi.advanceTimersByTimeAsync(10)

    await expect(result).resolves.toBe('signaled')
    expect(target.signalTtyMembers).toHaveBeenCalledTimes(3)
  })

  it('does not retry a partial native signal', async () => {
    const target = subject(-2)

    await expect(retryLiveTerminalTtySignal(target.live, true, Date.now() + 50)).resolves.toBe(
      'partial',
    )
    expect(target.signalTtyMembers).toHaveBeenCalledOnce()
  })

  it('does not treat zero tty matches as proof that a detached root was handled', () => {
    expect(terminalTtySignalResolvedRoot('signaled')).toBe(true)
    expect(terminalTtySignalResolvedRoot('no-match')).toBe(false)
    expect(terminalTtySignalResolvedRoot('partial')).toBe(false)
    expect(terminalTtySignalResolvedRoot('unavailable')).toBe(false)
  })
})
