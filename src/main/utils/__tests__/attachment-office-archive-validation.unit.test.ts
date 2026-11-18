import { PassThrough } from 'node:stream'
import { fromAny } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fromBufferMock = vi.hoisted(() => vi.fn())

vi.mock('yauzl', () => ({ fromBuffer: fromBufferMock }))

import { validateOfficeArchive } from '../attachment-office-archive-validation'

describe('attachment office archive validation', () => {
  beforeEach(() => {
    fromBufferMock.mockReset()
  })

  it('turns an abort while opening an entry stream into a controlled timeout', async () => {
    const controller = new AbortController()
    const stream = new PassThrough()
    const zipFile = fromAny({
      entryCount: 1,
      eachEntry: async function* () {
        yield fromAny({ uncompressedSize: 1 })
      },
      openReadStreamPromise: async () => {
        controller.abort()
        return stream
      },
      close: vi.fn(),
    })
    fromBufferMock.mockImplementation(
      (
        _buffer: Buffer,
        _options: unknown,
        callback: (error: Error | null, value: unknown) => void,
      ) => callback(null, zipFile),
    )

    await expect(validateOfficeArchive(Buffer.from('archive'), controller.signal)).rejects.toThrow(
      'exceeded',
    )
    expect(stream.destroyed).toBe(true)
  })
})
