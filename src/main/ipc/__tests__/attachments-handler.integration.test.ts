import { ATTACHMENT } from '@shared/constants/resource-limits'
import type { PreparedAttachment } from '@shared/types/agent'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  typedHandleMock,
  createLoggerMock,
  attachmentsLoggerMock,
  statMock,
  readFileMock,
  realpathMock,
  mkdirMock,
  openMock,
  readdirMock,
  unlinkMock,
  appGetPathMock,
  broadcastToWindowsMock,
  unpdfExtractTextMock,
  ocrRecognizeMock,
  mammothExtractMock,
  jszipLoadAsyncMock,
  showMessageBoxMock,
  files,
} = vi.hoisted(() => ({
  typedHandleMock: vi.fn(),
  createLoggerMock: vi.fn(),
  attachmentsLoggerMock: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  statMock: vi.fn(),
  readFileMock: vi.fn(),
  realpathMock: vi.fn(),
  mkdirMock: vi.fn(),
  openMock: vi.fn(),
  readdirMock: vi.fn(),
  unlinkMock: vi.fn(),
  appGetPathMock: vi.fn(),
  broadcastToWindowsMock: vi.fn(),
  unpdfExtractTextMock: vi.fn(),
  ocrRecognizeMock: vi.fn(),
  mammothExtractMock: vi.fn(),
  jszipLoadAsyncMock: vi.fn(),
  showMessageBoxMock: vi.fn(),
  files: new Map<
    string,
    { size: number; content: Buffer; isFile: boolean; isDirectory: boolean; mtimeMs: number }
  >(),
}))

vi.mock('../typed-ipc', () => ({
  typedHandle: typedHandleMock,
}))

vi.mock('../../logger', () => ({
  createLogger: createLoggerMock.mockImplementation(() => attachmentsLoggerMock),
}))

vi.mock('node:fs/promises', () => ({
  default: {
    stat: statMock,
    readFile: readFileMock,
    realpath: realpathMock,
    mkdir: mkdirMock,
    open: openMock,
    readdir: readdirMock,
    unlink: unlinkMock,
  },
  stat: statMock,
  readFile: readFileMock,
  realpath: realpathMock,
  mkdir: mkdirMock,
  open: openMock,
  readdir: readdirMock,
  unlink: unlinkMock,
}))

vi.mock('../../utils/broadcast', () => ({
  broadcastToWindows: broadcastToWindowsMock,
}))

vi.mock('electron', () => ({
  app: {
    getPath: appGetPathMock,
  },
  dialog: {
    showMessageBox: showMessageBoxMock,
  },
}))

vi.mock('unpdf', () => ({
  extractText: unpdfExtractTextMock,
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

import { hydrateAttachmentSources, registerAttachmentHandlers } from '../attachments-handler'

function registeredHandler(name: string): ((...args: unknown[]) => Promise<unknown>) | undefined {
  const call = typedHandleMock.mock.calls.find((c: unknown[]) => c[0] === name)
  const handler = call?.[1]
  if (typeof handler !== 'function') {
    return undefined
  }
  return (...args: unknown[]) => Effect.runPromise(handler(...args))
}

function registerFile(
  path: string,
  content: string | Buffer,
  size?: number,
  mtimeMs = Date.now(),
): void {
  const buffer = typeof content === 'string' ? Buffer.from(content, 'utf8') : content
  files.set(path, {
    size: size ?? buffer.length,
    content: buffer,
    isFile: true,
    isDirectory: false,
    mtimeMs,
  })
}

function registerDirectory(path: string, mtimeMs = Date.now()): void {
  files.set(path, {
    size: 0,
    content: Buffer.alloc(0),
    isFile: false,
    isDirectory: true,
    mtimeMs,
  })
}

describe('registerAttachmentHandlers', () => {
  beforeEach(() => {
    typedHandleMock.mockReset()
    createLoggerMock.mockReset()
    attachmentsLoggerMock.debug.mockReset()
    attachmentsLoggerMock.info.mockReset()
    attachmentsLoggerMock.warn.mockReset()
    attachmentsLoggerMock.error.mockReset()
    statMock.mockReset()
    readFileMock.mockReset()
    realpathMock.mockReset()
    mkdirMock.mockReset()
    openMock.mockReset()
    readdirMock.mockReset()
    unlinkMock.mockReset()
    appGetPathMock.mockReset()
    broadcastToWindowsMock.mockReset()
    unpdfExtractTextMock.mockReset()
    ocrRecognizeMock.mockReset()
    mammothExtractMock.mockReset()
    jszipLoadAsyncMock.mockReset()
    showMessageBoxMock.mockReset()
    files.clear()
    registerDirectory('/tmp/repo')

    statMock.mockImplementation(async (filePath: string) => {
      const file = files.get(filePath)
      if (!file) {
        throw new Error(`ENOENT: ${filePath}`)
      }
      return {
        size: file.size,
        isFile: () => file.isFile,
        isDirectory: () => file.isDirectory,
        mtimeMs: file.mtimeMs,
      }
    })

    readFileMock.mockImplementation(async (filePath: string) => {
      const file = files.get(filePath)
      if (!file) {
        throw new Error(`ENOENT: ${filePath}`)
      }
      return file.content
    })

    realpathMock.mockImplementation(async (filePath: string) => {
      if (filePath === '/tmp/repo') return '/tmp/repo'
      const file = files.get(filePath)
      if (file) return filePath
      throw new Error(`ENOENT: ${filePath}`)
    })
    mkdirMock.mockResolvedValue(undefined)
    openMock.mockImplementation(async (filePath: string) => {
      let output = Buffer.alloc(0)
      return {
        write: async (buffer: Buffer, offset: number, length: number, position: number) => {
          const chunk = Buffer.from(buffer.subarray(offset, offset + length))
          const requiredBytes = position + chunk.length
          if (output.length < requiredBytes) {
            const grown = Buffer.alloc(requiredBytes)
            output.copy(grown)
            output = grown
          }
          chunk.copy(output, position)
          return { bytesWritten: chunk.length, buffer: chunk }
        },
        close: async () => {
          registerFile(filePath, Buffer.from(output))
        },
      }
    })
    readdirMock.mockResolvedValue([])
    unlinkMock.mockImplementation(async (filePath: string) => {
      files.delete(filePath)
    })
    appGetPathMock.mockReturnValue('/tmp/user-data')

    unpdfExtractTextMock.mockResolvedValue({ text: 'Extracted PDF text' })
    ocrRecognizeMock.mockResolvedValue({ data: { text: 'OCR extracted text' } })
    mammothExtractMock.mockResolvedValue({ value: 'Extracted DOCX text' })
    showMessageBoxMock.mockResolvedValue({ response: 0 })
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
    }>

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'text',
      origin: 'user-file',
      extractedText: 'Hello from notes',
    })
    expect(result[0]).not.toHaveProperty('source')
    expect(showMessageBoxMock).not.toHaveBeenCalled()
  })

  it('prepares PDF attachments via parser', async () => {
    registerFile('/tmp/repo/spec.pdf', Buffer.from('fake-pdf-data'))

    registerAttachmentHandlers()
    const handler = registeredHandler('attachments:prepare')

    const result = (await handler?.({}, '/tmp/repo', ['/tmp/repo/spec.pdf'])) as Array<{
      kind: string
      extractedText: string
    }>

    expect(unpdfExtractTextMock).toHaveBeenCalledOnce()
    expect(result[0]).toMatchObject({
      kind: 'pdf',
      extractedText: 'Extracted PDF text',
    })
    expect(result[0]).not.toHaveProperty('source')
  })

  it('logs and degrades gracefully when PDF extraction fails', async () => {
    registerFile('/tmp/repo/spec.pdf', Buffer.from('fake-pdf-data'))
    unpdfExtractTextMock.mockRejectedValueOnce(new Error('pdf parser exploded'))

    registerAttachmentHandlers()
    const handler = registeredHandler('attachments:prepare')

    const result = (await handler?.({}, '/tmp/repo', ['/tmp/repo/spec.pdf'])) as Array<{
      kind: string
      extractedText: string
    }>

    expect(result[0]).toMatchObject({
      kind: 'pdf',
      extractedText: '',
    })
    expect(attachmentsLoggerMock.warn).toHaveBeenCalledWith(
      'Attachment text extraction failed',
      expect.objectContaining({
        attachment: 'spec.pdf',
        extractor: 'pdf',
        error: 'pdf parser exploded',
      }),
    )
  })

  it('prepares image attachments with OCR fallback text', async () => {
    registerFile('/tmp/repo/screenshot.png', Buffer.from('fake-image-data'))

    registerAttachmentHandlers()
    const handler = registeredHandler('attachments:prepare')

    const result = (await handler?.({}, '/tmp/repo', ['/tmp/repo/screenshot.png'])) as Array<{
      kind: string
      extractedText: string
    }>

    expect(ocrRecognizeMock).toHaveBeenCalledOnce()
    expect(result[0]).toMatchObject({
      kind: 'image',
      extractedText: 'OCR extracted text',
    })
    expect(result[0]).not.toHaveProperty('source')
  })

  it('logs and degrades gracefully when image OCR fails', async () => {
    registerFile('/tmp/repo/screenshot.png', Buffer.from('fake-image-data'))
    ocrRecognizeMock.mockRejectedValueOnce(new Error('ocr exploded'))

    registerAttachmentHandlers()
    const handler = registeredHandler('attachments:prepare')

    const result = (await handler?.({}, '/tmp/repo', ['/tmp/repo/screenshot.png'])) as Array<{
      kind: string
      extractedText: string
    }>

    expect(result[0]).toMatchObject({
      kind: 'image',
      extractedText: '',
    })
    expect(attachmentsLoggerMock.warn).toHaveBeenCalledWith(
      'Attachment text extraction failed',
      expect.objectContaining({
        attachment: 'screenshot.png',
        extractor: 'image-ocr',
        error: 'ocr exploded',
      }),
    )
  })

  it('extracts text from DOCX attachments', async () => {
    registerFile('/tmp/repo/spec.docx', Buffer.from('fake-docx-bytes'))

    registerAttachmentHandlers()
    const handler = registeredHandler('attachments:prepare')

    const result = (await handler?.({}, '/tmp/repo', ['/tmp/repo/spec.docx'])) as Array<{
      kind: string
      extractedText: string
    }>

    expect(mammothExtractMock).toHaveBeenCalledOnce()
    expect(result[0]).toMatchObject({
      kind: 'text',
      extractedText: 'Extracted DOCX text',
    })
    expect(result[0]).not.toHaveProperty('source')
  })

  it('logs and degrades gracefully when DOCX extraction fails', async () => {
    registerFile('/tmp/repo/spec.docx', Buffer.from('fake-docx-bytes'))
    mammothExtractMock.mockRejectedValueOnce(new Error('docx parser exploded'))

    registerAttachmentHandlers()
    const handler = registeredHandler('attachments:prepare')

    const result = (await handler?.({}, '/tmp/repo', ['/tmp/repo/spec.docx'])) as Array<{
      kind: string
      extractedText: string
    }>

    expect(result[0]).toMatchObject({
      kind: 'text',
      extractedText: '',
    })
    expect(attachmentsLoggerMock.warn).toHaveBeenCalledWith(
      'Attachment text extraction failed',
      expect.objectContaining({
        attachment: 'spec.docx',
        extractor: 'docx',
        error: 'docx parser exploded',
      }),
    )
  })

  it('extracts text from ODT attachments', async () => {
    registerFile('/tmp/repo/spec.odt', Buffer.from('fake-odt-bytes'))

    registerAttachmentHandlers()
    const handler = registeredHandler('attachments:prepare')

    const result = (await handler?.({}, '/tmp/repo', ['/tmp/repo/spec.odt'])) as Array<{
      kind: string
      extractedText: string
    }>

    expect(jszipLoadAsyncMock).toHaveBeenCalledOnce()
    expect(result[0]).toMatchObject({
      kind: 'text',
      extractedText: 'Hello ODT',
    })
    expect(result[0]).not.toHaveProperty('source')
  })

  it('logs and degrades gracefully when ODT extraction fails', async () => {
    registerFile('/tmp/repo/spec.odt', Buffer.from('fake-odt-bytes'))
    jszipLoadAsyncMock.mockRejectedValueOnce(new Error('odt parser exploded'))

    registerAttachmentHandlers()
    const handler = registeredHandler('attachments:prepare')

    const result = (await handler?.({}, '/tmp/repo', ['/tmp/repo/spec.odt'])) as Array<{
      kind: string
      extractedText: string
    }>

    expect(result[0]).toMatchObject({
      kind: 'text',
      extractedText: '',
    })
    expect(attachmentsLoggerMock.warn).toHaveBeenCalledWith(
      'Attachment text extraction failed',
      expect.objectContaining({
        attachment: 'spec.odt',
        extractor: 'odt',
        error: 'odt parser exploded',
      }),
    )
  })

  it('extracts text from RTF attachments', async () => {
    registerFile('/tmp/repo/spec.rtf', '{\\rtf1\\ansi Hello\\par world}')

    registerAttachmentHandlers()
    const handler = registeredHandler('attachments:prepare')

    const result = (await handler?.({}, '/tmp/repo', ['/tmp/repo/spec.rtf'])) as Array<{
      kind: string
      extractedText: string
    }>

    expect(result[0]).toMatchObject({
      kind: 'text',
      extractedText: 'Hello\nworld',
    })
    expect(result[0]).not.toHaveProperty('source')
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

  it('rejects files outside the selected project root', async () => {
    registerFile('/tmp/outside.txt', 'outside')

    registerAttachmentHandlers()
    const handler = registeredHandler('attachments:prepare')

    await expect(handler?.({}, '/tmp/repo', ['/tmp/outside.txt'])).rejects.toThrow(
      'Attachments must be inside the selected project.',
    )
    expect(showMessageBoxMock).not.toHaveBeenCalled()
  })

  it('hydrates binary source for image/pdf attachments in main process', async () => {
    registerFile('/tmp/repo/diagram.png', Buffer.from('image-bytes'))
    registerFile('/tmp/repo/spec.pdf', Buffer.from('pdf-bytes'))
    registerFile('/tmp/repo/notes.txt', Buffer.from('notes'))

    registerAttachmentHandlers()
    const handler = registeredHandler('attachments:prepare')
    const prepared = (await handler?.({}, '/tmp/repo', [
      '/tmp/repo/diagram.png',
      '/tmp/repo/spec.pdf',
      '/tmp/repo/notes.txt',
    ])) as PreparedAttachment[]

    const hydrated = await hydrateAttachmentSources(prepared)

    expect(hydrated[0]).toMatchObject({
      kind: 'image',
      source: { type: 'data', mimeType: 'image/png' },
    })
    expect(hydrated[1]).toMatchObject({
      kind: 'pdf',
      source: { type: 'data', mimeType: 'application/pdf' },
    })
    expect(hydrated[2]).toMatchObject({
      kind: 'text',
      source: null,
    })
  })

  describe('attachments:prepare-from-text', () => {
    it('preserves full long text without truncation and returns markdown metadata', async () => {
      registerAttachmentHandlers()
      const handler = registeredHandler('attachments:prepare-from-text')
      expect(handler).toBeDefined()

      const longText = 'x'.repeat(50_000)
      const result = await handler?.({}, longText, 'operation-1')

      expect(result).toMatchObject({
        kind: 'text',
        origin: 'auto-paste-text',
        mimeType: 'text/markdown',
        extractedText: longText,
      })
      expect(result).toEqual(
        expect.objectContaining({
          name: expect.stringMatching(/^prompt-\d+\.md$/),
        }),
      )
      expect(openMock).toHaveBeenCalledOnce()
      const progressCalls = broadcastToWindowsMock.mock.calls.filter(
        (call: unknown[]) => call[0] === 'attachments:prepare-from-text-progress',
      )
      expect(progressCalls.length).toBeGreaterThan(1)
      const lastProgressCall = progressCalls[progressCalls.length - 1]
      expect(lastProgressCall?.[1]).toMatchObject({
        operationId: 'operation-1',
        stage: 'completed',
        progressPercent: 100,
      })
    })

    it('rejects empty text input', async () => {
      registerAttachmentHandlers()
      const handler = registeredHandler('attachments:prepare-from-text')

      await expect(handler?.({}, '', 'operation-2')).rejects.toThrow()
    })

    it('rejects text input larger than the per-attachment limit', async () => {
      registerAttachmentHandlers()
      const handler = registeredHandler('attachments:prepare-from-text')
      const oversizedText = 'x'.repeat(ATTACHMENT.MAX_SIZE_BYTES + 1)

      await expect(handler?.({}, oversizedText, 'operation-oversized')).rejects.toThrow(
        'Generated attachment exceeds 8 MB.',
      )
    })
  })

  it('runs cleanup on registration and ignores cleanup errors', async () => {
    readdirMock.mockRejectedValueOnce(new Error('cleanup failed'))

    registerAttachmentHandlers()
    await Promise.resolve()

    expect(registeredHandler('attachments:prepare')).toBeDefined()
    expect(registeredHandler('attachments:prepare-from-text')).toBeDefined()
  })
})
