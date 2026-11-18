import { describe, expect, it } from 'vitest'
import { chunkTerminalInput, sliceTerminalDataAfterBytes } from '../terminal-input'

const utf8 = new TextEncoder()

describe('chunkTerminalInput', () => {
  it('preserves a large ASCII paste in byte-bounded order', () => {
    const input = 'abc123\n'.repeat(200_000)
    const chunks = chunkTerminalInput(input, 257)

    expect(chunks.join('')).toBe(input)
    expect(chunks.every((chunk) => utf8.encode(chunk).byteLength <= 257)).toBe(true)
  })

  it('never splits multi-byte code points or miscounts UTF-8 bytes', () => {
    const input = 'A🙂é漢B'.repeat(50)
    const chunks = chunkTerminalInput(input, 9)

    expect(chunks.join('')).toBe(input)
    expect(chunks.every((chunk) => utf8.encode(chunk).byteLength <= 9)).toBe(true)
    expect(chunks.every((chunk) => !chunk.includes('\uFFFD'))).toBe(true)
  })

  it('returns no writes for empty input and rejects unusable limits', () => {
    expect(chunkTerminalInput('')).toEqual([])
    expect(() => chunkTerminalInput('x', 3)).toThrow(RangeError)
  })
})

describe('sliceTerminalDataAfterBytes', () => {
  it('uses UTF-8 offsets rather than UTF-16 code units', () => {
    const data = 'A🙂é漢B'

    expect(sliceTerminalDataAfterBytes(data, 0)).toBe(data)
    expect(sliceTerminalDataAfterBytes(data, 1)).toBe('🙂é漢B')
    expect(sliceTerminalDataAfterBytes(data, 5)).toBe('é漢B')
    expect(sliceTerminalDataAfterBytes(data, 7)).toBe('漢B')
    expect(sliceTerminalDataAfterBytes(data, 10)).toBe('B')
    expect(sliceTerminalDataAfterBytes(data, 11)).toBe('')
  })
})
