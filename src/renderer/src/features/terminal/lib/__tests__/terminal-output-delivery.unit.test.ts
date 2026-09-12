import type { TerminalAttachResult } from '@shared/types/terminal'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { createTerminalOutputDelivery } from '../terminal-output-delivery'

function setup(history = '') {
  const write = vi.fn<(data: string | Uint8Array, callback?: () => void) => void>()
  const acknowledge = vi.fn()
  const delivery = createTerminalOutputDelivery({
    ownerKey: 'owner',
    terminalId: 'terminal',
    terminal: fromPartial({ write }),
    acknowledge,
  })
  delivery.applySnapshot(
    fromPartial<TerminalAttachResult>({
      history,
      outputBytes: new TextEncoder().encode(history).byteLength,
      outputGeneration: 1,
    }),
  )
  return { delivery, write, acknowledge }
}

describe('terminal output parser batches', () => {
  it('bounds parser work without acknowledging any part of an event early', () => {
    const { delivery, write, acknowledge } = setup()
    const data = '0123456789abcdef\r\n'.repeat(8_000)
    delivery.write({
      type: 'output',
      data,
      outputGeneration: 1,
      startOffset: 0,
      endOffset: data.length,
    })

    expect(write.mock.calls.length).toBeGreaterThan(1)
    expect(write.mock.calls.map(([chunk]) => chunk).join('')).toBe(data)
    expect(write.mock.calls.every(([chunk]) => chunk.length <= 4_096)).toBe(true)
    for (const [, callback] of write.mock.calls.slice(0, -1)) callback?.()
    expect(acknowledge).not.toHaveBeenCalled()
    write.mock.calls.at(-1)?.[1]?.()
    expect(acknowledge).toHaveBeenCalledExactlyOnceWith('owner', 'terminal', 1, data.length)
  })

  it('bounds attach-history parsing and preserves Unicode and escape sequences', () => {
    const history = `${'x'.repeat(4_095)}😀\x1b[31m${'é'.repeat(20_000)}\x1b[0m`
    const { write } = setup(history)
    expect(write.mock.calls.length).toBeGreaterThan(1)
    expect(write.mock.calls.map(([chunk]) => chunk).join('')).toBe(history)
    for (const [chunk] of write.mock.calls) {
      expect(typeof chunk).toBe('string')
      if (typeof chunk === 'string') expect(chunk.isWellFormed()).toBe(true)
      expect(chunk.length).toBeLessThanOrEqual(4_096)
    }
  })
})
