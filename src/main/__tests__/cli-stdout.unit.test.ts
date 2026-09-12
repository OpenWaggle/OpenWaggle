import { Writable, type WritableOptions } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { writeWritableChunk } from '../cli-stdout'

class ControlledWritable extends Writable {
  readonly callbacks: Array<(error?: Error | null) => void> = []

  constructor(options: WritableOptions = {}) {
    super({ highWaterMark: 1, ...options })
  }

  override _write(
    _chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    this.callbacks.push(callback)
  }
}

describe('CLI stdout', () => {
  it('does not consume the next event until a backpressured write drains', async () => {
    const output = new ControlledWritable()
    const consumed: number[] = []
    const writing = (async () => {
      for (const event of [1, 2]) {
        consumed.push(event)
        await writeWritableChunk(output, String(event))
      }
    })()

    expect(consumed).toEqual([1])
    expect(output.callbacks).toHaveLength(1)
    output.callbacks.shift()?.()
    await vi.waitFor(() => expect(consumed).toEqual([1, 2]))
    output.callbacks.shift()?.()
    await writing
  })

  it('rejects a failed write without leaving its error event unhandled', async () => {
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error('boom'))
      },
    })

    await expect(writeWritableChunk(output, 'x')).rejects.toThrow('boom')
    await new Promise<void>((resolve) => setImmediate(resolve))
  })
})
