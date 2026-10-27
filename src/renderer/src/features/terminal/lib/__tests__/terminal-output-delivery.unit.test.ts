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

describe('terminal attach history replay', () => {
  it('scrubs terminal queries from attach history but keeps what renders and an open tail', () => {
    const history = 'a\x1b]4;0;?\x1b\\b\x1b[6n\x1b[31mc\x1b[0m\x1b]11;?\x07d\x1b]4;1;'
    const { write } = setup(history)

    expect(write.mock.calls.map(([chunk]) => chunk).join('')).toBe('ab\x1b[31mc\x1b[0md\x1b]4;1;')
  })

  it('reports a replay in flight until xterm has parsed its last slice', () => {
    const { delivery, write } = setup(`${'0123456789abcdef\r\n'.repeat(1_000)}`)

    expect(delivery.isReplaying()).toBe(true)
    for (const [, callback] of write.mock.calls.slice(0, -1)) callback?.()
    expect(delivery.isReplaying()).toBe(true)
    write.mock.calls.at(-1)?.[1]?.()
    expect(delivery.isReplaying()).toBe(false)
  })

  it('has no replay in flight for an empty history', () => {
    const { delivery, write } = setup('')

    expect(write).not.toHaveBeenCalled()
    expect(delivery.isReplaying()).toBe(false)
  })

  it('keeps the window open until every overlapping replay has been parsed', () => {
    const { delivery, write } = setup('first replay')
    delivery.reset()
    delivery.applySnapshot(
      fromPartial<TerminalAttachResult>({
        history: 'second replay',
        outputBytes: 13,
        outputGeneration: 2,
      }),
    )

    write.mock.calls[0]?.[1]?.()
    expect(delivery.isReplaying()).toBe(true)
    write.mock.calls[1]?.[1]?.()
    expect(delivery.isReplaying()).toBe(false)
  })
})
