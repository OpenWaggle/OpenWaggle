import { constants as osConstants } from 'node:os'
import { fromPartial } from '@total-typescript/shoehorn'
import type * as NodePtyModule from 'node-pty'
import { describe, expect, it, vi } from 'vitest'
import { createNativeTtyMemberSignal } from '../terminal-pty-native-signal'

function subject(signalByTty: (...args: readonly unknown[]) => unknown, fd: unknown = 42) {
  const pty = fromPartial<typeof NodePtyModule>({})
  Reflect.set(pty, 'native', { signalByTty })
  const spawned = fromPartial<NodePtyModule.IPty>({ pid: 4321 })
  Reflect.set(spawned, 'fd', fd)
  return createNativeTtyMemberSignal(pty, spawned, 'darwin:16:42', 'darwin:123:456')
}

describe('createNativeTtyMemberSignal', () => {
  it('binds graceful and forced signals to the exact master descriptor', () => {
    const signalByTty = vi.fn(() => 3)
    const signal = subject(signalByTty)

    expect(signal?.(false)).toBe(3)
    expect(signal?.(true)).toBe(3)
    expect(signalByTty).toHaveBeenNthCalledWith(
      1,
      42,
      'darwin:16:42',
      4321,
      'darwin:123:456',
      osConstants.signals.SIGHUP,
    )
    expect(signalByTty).toHaveBeenNthCalledWith(
      2,
      42,
      'darwin:16:42',
      4321,
      'darwin:123:456',
      osConstants.signals.SIGKILL,
    )
  })

  it('contains native failures and malformed results', () => {
    expect(
      subject(() => {
        throw new Error('native probe unavailable')
      })?.(false),
    ).toBeNull()
    expect(subject(() => '3')?.(false)).toBeNull()
  })

  it.each([null, -1, 1.5, '42'])('rejects unavailable master descriptor %j', (fd) => {
    const signalByTty = vi.fn(() => 1)

    expect(subject(signalByTty, fd)).toBeUndefined()
    expect(signalByTty).not.toHaveBeenCalled()
  })
})
