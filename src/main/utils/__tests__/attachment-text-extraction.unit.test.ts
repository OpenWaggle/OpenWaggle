import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  recognize: vi.fn(async () => ({ data: { text: '  scanned text  ' } })),
}))

vi.mock('tesseract.js', () => ({ recognize: mocks.recognize }))

import { extractAttachmentText } from '../attachment-text-extraction'

describe('attachment image text extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps Tesseract language data out of the repository working directory', async () => {
    const buffer = Buffer.from('image')

    await expect(
      extractAttachmentText({
        kind: 'image',
        mimeType: 'image/png',
        buffer,
        attachmentName: 'scan.png',
      }),
    ).resolves.toBe('scanned text')

    expect(mocks.recognize).toHaveBeenCalledWith(buffer, 'eng', {
      cachePath: path.join(os.tmpdir(), 'openwaggle-tesseract-cache'),
    })
  })
})
