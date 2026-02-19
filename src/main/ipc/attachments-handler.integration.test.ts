import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handleMock, statMock, readFileMock, pdfParseMock, ocrRecognizeMock, files } = vi.hoisted(
  () => ({
    handleMock: vi.fn(),
    statMock: vi.fn(),
    readFileMock: vi.fn(),
    pdfParseMock: vi.fn(),
    ocrRecognizeMock: vi.fn(),
    files: new Map<string, { size: number; content: Buffer; isFile: boolean }>(),
  }),
)

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock,
  },
}))

vi.mock('node:fs/promises', () => ({
  default: {
    stat: statMock,
    readFile: readFileMock,
  },
  stat: statMock,
  readFile: readFileMock,
}))

vi.mock('pdf-parse', () => ({
  default: pdfParseMock,
}))

vi.mock('tesseract.js', () => ({
  recognize: ocrRecognizeMock,
}))

import { registerAttachmentHandlers } from './attachments-handler'

function registeredHandler(name: string): ((...args: unknown[]) => Promise<unknown>) | undefined {
  const call = handleMock.mock.calls.find(([channel]) => channel === name)
  return call?.[1] as ((...args: unknown[]) => Promise<unknown>) | undefined
}

function registerFile(path: string, content: string | Buffer, size?: number): void {
  const buffer = typeof content === 'string' ? Buffer.from(content, 'utf8') : content
  files.set(path, {
    size: size ?? buffer.length,
    content: buffer,
    isFile: true,
  })
}

describe('registerAttachmentHandlers', () => {
  beforeEach(() => {
    handleMock.mockReset()
    statMock.mockReset()
    readFileMock.mockReset()
    pdfParseMock.mockReset()
    ocrRecognizeMock.mockReset()
    files.clear()

    statMock.mockImplementation(async (filePath: string) => {
      const file = files.get(filePath)
      if (!file) {
        throw new Error(`ENOENT: ${filePath}`)
      }
      return {
        size: file.size,
        isFile: () => file.isFile,
      }
    })

    readFileMock.mockImplementation(async (filePath: string) => {
      const file = files.get(filePath)
      if (!file) {
        throw new Error(`ENOENT: ${filePath}`)
      }
      return file.content
    })

    pdfParseMock.mockResolvedValue({ text: 'Extracted PDF text' })
    ocrRecognizeMock.mockResolvedValue({ data: { text: 'OCR extracted text' } })
  })

  it('prepares text attachments with extracted text and no binary source', async () => {
    registerFile('/tmp/repo/notes.txt', 'Hello from notes')

    registerAttachmentHandlers()
    const handler = registeredHandler('attachments:prepare')
    expect(handler).toBeDefined()

    const result = (await handler?.({}, '/tmp/repo', ['/tmp/repo/notes.txt'])) as Array<{
      kind: string
      extractedText: string
      source: unknown
    }>

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'text',
      extractedText: 'Hello from notes',
      source: null,
    })
  })

  it('prepares PDF attachments via parser', async () => {
    registerFile('/tmp/repo/spec.pdf', Buffer.from('fake-pdf-data'))

    registerAttachmentHandlers()
    const handler = registeredHandler('attachments:prepare')

    const result = (await handler?.({}, '/tmp/repo', ['/tmp/repo/spec.pdf'])) as Array<{
      kind: string
      extractedText: string
      source: { type: string; mimeType: string } | null
    }>

    expect(pdfParseMock).toHaveBeenCalledOnce()
    expect(result[0]).toMatchObject({
      kind: 'pdf',
      extractedText: 'Extracted PDF text',
      source: {
        type: 'data',
        mimeType: 'application/pdf',
      },
    })
  })

  it('prepares image attachments with OCR fallback text', async () => {
    registerFile('/tmp/repo/screenshot.png', Buffer.from('fake-image-data'))

    registerAttachmentHandlers()
    const handler = registeredHandler('attachments:prepare')

    const result = (await handler?.({}, '/tmp/repo', ['/tmp/repo/screenshot.png'])) as Array<{
      kind: string
      extractedText: string
      source: { type: string; mimeType: string } | null
    }>

    expect(ocrRecognizeMock).toHaveBeenCalledOnce()
    expect(result[0]).toMatchObject({
      kind: 'image',
      extractedText: 'OCR extracted text',
      source: {
        type: 'data',
        mimeType: 'image/png',
      },
    })
  })

  it('rejects unsupported attachment types', async () => {
    registerFile('/tmp/repo/archive.zip', Buffer.from('zip-data'))

    registerAttachmentHandlers()
    const handler = registeredHandler('attachments:prepare')

    await expect(handler?.({}, '/tmp/repo', ['/tmp/repo/archive.zip'])).rejects.toThrow(
      'Unsupported attachment type',
    )
  })

  it('rejects attachments larger than per-file limit', async () => {
    registerFile('/tmp/repo/huge.txt', Buffer.from('small-buffer'), 9 * 1024 * 1024)

    registerAttachmentHandlers()
    const handler = registeredHandler('attachments:prepare')

    await expect(handler?.({}, '/tmp/repo', ['/tmp/repo/huge.txt'])).rejects.toThrow(
      'Attachment exceeds 8 MB',
    )
  })

  it('rejects payloads that exceed total size limit', async () => {
    registerFile('/tmp/repo/a.txt', Buffer.from('a'), 12 * 1024 * 1024)
    registerFile('/tmp/repo/b.txt', Buffer.from('b'), 12 * 1024 * 1024)

    registerAttachmentHandlers()
    const handler = registeredHandler('attachments:prepare')

    await expect(
      handler?.({}, '/tmp/repo', ['/tmp/repo/a.txt', '/tmp/repo/b.txt']),
    ).rejects.toThrow('Total attachment size exceeds 20 MB')
  })
})
