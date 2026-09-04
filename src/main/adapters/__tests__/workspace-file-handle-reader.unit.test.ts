import { describe, expect, it, vi } from 'vitest'
import { readBoundedFileRange } from '../workspace-file-handle-reader'

describe('workspace file handle reader', () => {
  it('continues across legal short reads and returns only observed bytes', async () => {
    const source = Buffer.from('complete text sample')
    const read = vi.fn(async (buffer: Buffer, offset: number, length: number, position: number) => {
      const chunk = source.subarray(position, position + Math.min(length, 3))
      chunk.copy(buffer, offset)
      return { bytesRead: chunk.length, buffer }
    })

    const result = await readBoundedFileRange({ read }, source.length + 20, 0)

    expect(result.toString('utf8')).toBe('complete text sample')
    expect(read.mock.calls.length).toBeGreaterThan(1)
    expect(result).toHaveLength(source.length)
  })
})
