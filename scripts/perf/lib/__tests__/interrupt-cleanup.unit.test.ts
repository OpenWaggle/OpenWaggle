import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { createInterruptCleanup, type SignalTarget } from '../interrupt-cleanup'

/** R6 P2-4: an interrupted harness stops what it launched, then removes its profiles, then exits. */
function harness() {
  const emitter = new EventEmitter()
  const target: SignalTarget = {
    on: (event, listener) => emitter.on(event, listener),
    off: (event, listener) => emitter.off(event, listener),
  }
  const exits: number[] = []
  let exited: () => void = () => undefined
  const exitedOnce = new Promise<void>((resolve) => {
    exited = resolve
  })
  const cleanup = createInterruptCleanup(target, (code) => {
    exits.push(code)
    exited()
  })
  return { emitter, cleanup, exits, exitedOnce }
}

describe('interrupt cleanup', () => {
  it('on SIGINT stops every process group, then disposes every profile, then exits 130', async () => {
    const { emitter, cleanup, exits, exitedOnce } = harness()
    const order: string[] = []
    cleanup.register('profile', async () => {
      order.push('profile removed')
    })
    cleanup.register('process', async () => {
      order.push('gui SIGTERM')
    })
    cleanup.register('process', async () => {
      order.push('cli SIGTERM')
    })

    emitter.emit('SIGINT', 'SIGINT')
    await exitedOnce

    expect(order).toEqual(['gui SIGTERM', 'cli SIGTERM', 'profile removed'])
    expect(exits).toEqual([130])
  })

  it.each([
    ['SIGTERM', 143],
    ['SIGHUP', 129],
  ])('exits %s with %i', async (signal, code) => {
    const { emitter, cleanup, exits, exitedOnce } = harness()
    cleanup.register('process', async () => undefined)
    emitter.emit(signal, signal)
    await exitedOnce
    expect(exits).toEqual([code])
  })

  it('keeps going when one cleanup fails, and skips what already finished', async () => {
    const { emitter, cleanup, exitedOnce } = harness()
    const done: string[] = []
    cleanup.register('process', async () => {
      throw new Error('already gone')
    })
    const unregister = cleanup.register('process', async () => {
      done.push('stopped twice')
    })
    cleanup.register('profile', async () => {
      done.push('profile removed')
    })
    unregister()
    emitter.emit('SIGINT', 'SIGINT')
    await exitedOnce
    expect(done).toEqual(['profile removed'])
  })

  it('listens only while something is registered', () => {
    const { emitter, cleanup } = harness()
    const first = cleanup.register('process', async () => undefined)
    const second = cleanup.register('profile', async () => undefined)
    expect(emitter.listenerCount('SIGINT')).toBe(1)
    first()
    expect(emitter.listenerCount('SIGINT')).toBe(1)
    second()
    expect(['SIGINT', 'SIGTERM', 'SIGHUP'].map((signal) => emitter.listenerCount(signal))).toEqual([0, 0, 0])
  })
})
