import { describe, expect, it } from 'vitest'
import { decompressSnappy, SnappyError } from '../snappy'

const text = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1')

describe('decompressSnappy', () => {
  it('expands literals and overlapping one-byte-offset copies', () => {
    // 12 bytes: literal "abcd", then copy length 8 from offset 4 (overlaps its own output).
    const block = Uint8Array.of(12, 0x0c, 0x61, 0x62, 0x63, 0x64, 0x11, 0x04)
    expect(text(decompressSnappy(block))).toBe('abcdabcdabcd')
  })

  it('reads two-byte offsets and literals with an extra length byte', () => {
    const literal = Buffer.from('x'.repeat(70))
    // Literal of 70 bytes: tag 60 << 2 with one extra length byte (69), then copy 5 from offset 70.
    const block = Buffer.concat([
      Uint8Array.of(75, 60 << 2, 69),
      literal,
      Uint8Array.of(((5 - 1) << 2) | 2, 70, 0),
    ])
    expect(text(decompressSnappy(block))).toBe('x'.repeat(75))
  })

  it('rejects copies that point before the output', () => {
    expect(() => decompressSnappy(Uint8Array.of(8, 0x11, 0x04))).toThrow(SnappyError)
  })

  it('rejects a block shorter than its header says', () => {
    expect(() => decompressSnappy(Uint8Array.of(5, 0x00, 0x61))).toThrow(SnappyError)
  })
})
