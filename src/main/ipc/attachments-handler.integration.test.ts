import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  safeHandleMock,
  statMock,
  readFileMock,
  pdfParseMock,
  ocrRecognizeMock,
  mammothExtractMock,
  jszipLoadAsyncMock,
  files,
} = vi.hoisted(() => ({
  safeHandleMock: vi.fn(),
  statMock: vi.fn(),
  readFileMock: vi.fn(),
  pdfParseMock: vi.fn(),
  ocrRecognizeMock: vi.fn(),
  mammothExtractMock: vi.fn(),
  jszipLoadAsyncMock: vi.fn(),
  files: new Map<string, { size: number; content: Buffer; isFile: boolean }>(),
}))

vi.mock('./typed-ipc', () => ({
  safeHandle: safeHandleMock,
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

vi.mock('mammoth', () => ({
  extractRawText: mammothExtractMock,
}))

vi.mock('jszip', () => ({
  default: {
    loadAsync: jszipLoadAsyncMock,
  },
}))

import { registerAttachmentHandlers } from './attachments-handler'

function registeredHandler(name: string): ((...args: unknown[]) => Promise<unknown>) | undefined {
  const call = safeHandleMock.mock.calls.find((c: unknown[]) => c[0] === name)
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
    safeHandleMock.mockReset()
    statMock.mockReset()
    readFileMock.mockReset()
    pdfParseMock.mockReset()
    ocrRecognizeMock.mockReset()
    mammothExtractMock.mockReset()
    jszipLoadAsyncMock.mockReset()
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
    mammothExtractMock.mockResolvedValue({ value: 'Extracted DOCX text' })
    jszipLoadAsyncMock.mockResolvedValue({
      file: (name: string) =>
        name === 'content.xml'
          ? {
              async: async () => '<text:p>Hello ODT</text:p>',
            }
          : null,
    })
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

  it('extracts text from DOCX attachments', async () => {
    registerFile('/tmp/repo/spec.docx', Buffer.from('fake-docx-bytes'))

    registerAttachmentHandlers()
    const handler = registeredHandler('attachments:prepare')

    const result = (await handler?.({}, '/tmp/repo', ['/tmp/repo/spec.docx'])) as Array<{
      kind: string
      extractedText: string
      source: unknown
    }>

    expect(mammothExtractMock).toHaveBeenCalledOnce()
    expect(result[0]).toMatchObject({
      kind: 'text',
      extractedText: 'Extracted DOCX text',
      source: null,
    })
  })

  it('extracts text from ODT attachments', async () => {
    registerFile('/tmp/repo/spec.odt', Buffer.from('fake-odt-bytes'))

    registerAttachmentHandlers()
    const handler = registeredHandler('attachments:prepare')

    const result = (await handler?.({}, '/tmp/repo', ['/tmp/repo/spec.odt'])) as Array<{
      kind: string
      extractedText: string
      source: unknown
    }>

    expect(jszipLoadAsyncMock).toHaveBeenCalledOnce()
    expect(result[0]).toMatchObject({
      kind: 'text',
      extractedText: 'Hello ODT',
      source: null,
    })
  })

  it('extracts text from RTF attachments', async () => {
    registerFile('/tmp/repo/spec.rtf', '{\\rtf1\\ansi Hello\\par world}')

    registerAttachmentHandlers()
    const handler = registeredHandler('attachments:prepare')

    const result = (await handler?.({}, '/tmp/repo', ['/tmp/repo/spec.rtf'])) as Array<{
      kind: string
      extractedText: string
      source: unknown
    }>

    expect(result[0]).toMatchObject({
      kind: 'text',
      extractedText: 'Hello\nworld',
      source: null,
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
