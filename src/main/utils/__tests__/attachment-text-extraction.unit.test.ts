import { ATTACHMENT } from '@shared/constants/resource-limits'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DOCX_MIME_TYPE,
  extractAttachmentText,
  ODT_MIME_TYPE,
  RTF_MIME_TYPE,
} from '../attachment-text-extraction'

const mocks = vi.hoisted(() => ({
  parserWorker: vi.fn(),
}))

vi.mock('../attachment-parser-worker', () => ({
  runAttachmentParserWorker: mocks.parserWorker,
}))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.parserWorker.mockResolvedValue('document text')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('attachment text extraction resource limits', () => {
  it('runs the complete image OCR path behind the killable parser-worker boundary', async () => {
    const buffer = Buffer.from('image')
    mocks.parserWorker.mockResolvedValueOnce('scanned text')

    await expect(
      extractAttachmentText({
        kind: 'image',
        mimeType: 'image/png',
        buffer,
        attachmentName: 'scan.png',
      }),
    ).resolves.toBe('scanned text')

    expect(mocks.parserWorker).toHaveBeenCalledWith(
      { kind: 'image', buffer },
      expect.any(AbortSignal),
    )
  })

  it('runs RTF extraction behind the bounded killable parser-worker boundary', async () => {
    vi.useFakeTimers()
    let workerSignal: AbortSignal | undefined
    mocks.parserWorker.mockImplementation(
      (_input, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          workerSignal = signal
          signal.addEventListener('abort', () => reject(new Error('worker terminated')), {
            once: true,
          })
        }),
    )
    const buffer = Buffer.from('{\\rtf1\\ansi Hello\\par world}')

    const extraction = extractAttachmentText({
      kind: 'text',
      mimeType: RTF_MIME_TYPE,
      buffer,
      attachmentName: 'document.rtf',
    })
    await vi.waitFor(() => {
      expect(mocks.parserWorker).toHaveBeenCalledWith(
        { kind: 'rtf', buffer },
        expect.any(AbortSignal),
      )
    })
    await vi.advanceTimersByTimeAsync(ATTACHMENT.EXTRACTION_TIMEOUT_MS)

    await expect(extraction).resolves.toBe('')
    expect(workerSignal?.aborted).toBe(true)
  })

  it.each([
    ['DOCX', DOCX_MIME_TYPE],
    ['ODT', ODT_MIME_TYPE],
  ])('rejects compressed %s expansion before document extraction', async (_label, mimeType) => {
    const archive = new JSZip()
    archive.file('content.xml', 'x'.repeat(ATTACHMENT.MAX_ARCHIVE_EXPANDED_BYTES + 1))
    const buffer = await archive.generateAsync({
      compression: 'DEFLATE',
      type: 'nodebuffer',
    })

    await expect(
      extractAttachmentText({
        kind: 'text',
        mimeType,
        buffer,
        attachmentName: 'oversized-office-document',
      }),
    ).resolves.toBe('')

    expect(mocks.parserWorker).not.toHaveBeenCalled()
  })

  it('times out a hung image parser worker', async () => {
    vi.useFakeTimers()
    mocks.parserWorker.mockImplementation(
      (_input, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('worker terminated')), {
            once: true,
          })
        }),
    )

    const extraction = extractAttachmentText({
      kind: 'image',
      mimeType: 'image/png',
      buffer: Buffer.from('hung image'),
      attachmentName: 'hung.png',
    })
    await vi.waitFor(() => {
      expect(mocks.parserWorker).toHaveBeenCalledOnce()
    })

    await vi.advanceTimersByTimeAsync(ATTACHMENT.EXTRACTION_TIMEOUT_MS)

    await expect(extraction).resolves.toBe('')
  })

  it('releases every scheduler slot after hung image-worker initialization is terminated', async () => {
    vi.useFakeTimers()
    mocks.parserWorker.mockImplementation(
      (_input, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('worker terminated')), {
            once: true,
          })
        }),
    )
    const blocked = Array.from({ length: ATTACHMENT.MAX_CONCURRENT_EXTRACTIONS }, (_, index) =>
      extractAttachmentText({
        kind: 'image',
        mimeType: 'image/png',
        buffer: Buffer.from(`image ${String(index)}`),
        attachmentName: `image-${String(index)}.png`,
      }),
    )

    await vi.waitFor(() => {
      expect(mocks.parserWorker).toHaveBeenCalledTimes(ATTACHMENT.MAX_CONCURRENT_EXTRACTIONS)
    })
    await vi.advanceTimersByTimeAsync(ATTACHMENT.EXTRACTION_TIMEOUT_MS)
    await expect(Promise.all(blocked)).resolves.toEqual(
      Array.from({ length: ATTACHMENT.MAX_CONCURRENT_EXTRACTIONS }, () => ''),
    )

    mocks.parserWorker.mockResolvedValueOnce('recovered')
    await expect(
      extractAttachmentText({
        kind: 'image',
        mimeType: 'image/png',
        buffer: Buffer.from('later image'),
        attachmentName: 'later.png',
      }),
    ).resolves.toBe('recovered')
    expect(mocks.parserWorker).toHaveBeenCalledTimes(ATTACHMENT.MAX_CONCURRENT_EXTRACTIONS + 1)
  })
})
