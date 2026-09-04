import os from 'node:os'
import path from 'node:path'
import { ATTACHMENT } from '@shared/constants/resource-limits'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOCX_MIME_TYPE, extractAttachmentText, ODT_MIME_TYPE } from '../attachment-text-extraction'

const mocks = vi.hoisted(() => ({
  createWorker: vi.fn(),
  metadata: vi.fn(),
  parserWorker: vi.fn(),
  recognize: vi.fn(),
  terminate: vi.fn(),
}))

vi.mock('sharp', () => ({
  default: vi.fn(() => ({ metadata: mocks.metadata })),
}))

vi.mock('tesseract.js', () => ({ createWorker: mocks.createWorker }))

vi.mock('../attachment-parser-worker', () => ({
  runAttachmentParserWorker: mocks.parserWorker,
}))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.metadata.mockResolvedValue({ height: 1, width: 1 })
  mocks.recognize.mockResolvedValue({ data: { text: '  scanned text  ' } })
  mocks.terminate.mockResolvedValue(undefined)
  mocks.createWorker.mockResolvedValue({
    recognize: mocks.recognize,
    terminate: mocks.terminate,
  })
  mocks.parserWorker.mockResolvedValue('document text')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('attachment text extraction resource limits', () => {
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

    expect(mocks.createWorker).toHaveBeenCalledWith('eng', undefined, {
      cachePath: path.join(os.tmpdir(), 'openwaggle-tesseract-cache'),
    })
    expect(mocks.recognize).toHaveBeenCalledWith(buffer)
    expect(mocks.terminate).toHaveBeenCalledOnce()
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

  it('rejects huge image dimensions before starting OCR', async () => {
    mocks.metadata.mockResolvedValue({
      height: 1,
      width: ATTACHMENT.MAX_IMAGE_PIXELS + 1,
    })

    await expect(
      extractAttachmentText({
        kind: 'image',
        mimeType: 'image/png',
        buffer: Buffer.from('oversized image'),
        attachmentName: 'oversized.png',
      }),
    ).resolves.toBe('')

    expect(mocks.createWorker).not.toHaveBeenCalled()
  })

  it('times out a hung OCR worker and terminates it', async () => {
    vi.useFakeTimers()
    let rejectRecognition: ((error: Error) => void) | undefined
    mocks.recognize.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectRecognition = (error: Error) => reject(error)
        }),
    )
    mocks.terminate.mockImplementation(async () => {
      rejectRecognition?.(new Error('OCR worker terminated'))
    })

    const extraction = extractAttachmentText({
      kind: 'image',
      mimeType: 'image/png',
      buffer: Buffer.from('hung image'),
      attachmentName: 'hung.png',
    })
    await vi.waitFor(() => {
      expect(mocks.recognize).toHaveBeenCalledOnce()
    })

    await vi.advanceTimersByTimeAsync(ATTACHMENT.EXTRACTION_TIMEOUT_MS)

    await expect(extraction).resolves.toBe('')
    expect(mocks.terminate).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(0)
  })

  it('enforces one global extraction limit across independent callers', async () => {
    const releaseRecognition: Array<() => void> = []
    mocks.createWorker.mockImplementation(async () => ({
      recognize: vi.fn(
        () =>
          new Promise((resolve) => {
            releaseRecognition.push(() => resolve({ data: { text: 'done' } }))
          }),
      ),
      terminate: vi.fn(async () => undefined),
    }))
    const requests = Array.from({ length: ATTACHMENT.MAX_CONCURRENT_EXTRACTIONS * 2 }, (_, index) =>
      extractAttachmentText({
        kind: 'image',
        mimeType: 'image/png',
        buffer: Buffer.from(`image ${String(index)}`),
        attachmentName: `image-${String(index)}.png`,
      }),
    )

    await vi.waitFor(() => {
      expect(mocks.createWorker).toHaveBeenCalledTimes(ATTACHMENT.MAX_CONCURRENT_EXTRACTIONS)
    })
    for (const release of releaseRecognition.splice(0)) release()

    await vi.waitFor(() => {
      expect(mocks.createWorker).toHaveBeenCalledTimes(ATTACHMENT.MAX_CONCURRENT_EXTRACTIONS * 2)
    })
    for (const release of releaseRecognition.splice(0)) release()

    await expect(Promise.all(requests)).resolves.toEqual(['done', 'done', 'done', 'done'])
  })
})
