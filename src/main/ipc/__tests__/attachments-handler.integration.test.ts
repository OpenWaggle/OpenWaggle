import { fromAny } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  attachmentsLoggerMock,
  jszipLoadAsyncMock,
  loadAttachmentHandlers,
  mammothExtractMock,
  ocrRecognizeMock,
  registeredHandler,
  registerFile,
  resetAttachmentHandlerMocks,
  showMessageBoxMock,
  unpdfExtractTextMock,
} from './attachments-handler.test-harness'

interface ExtractedAttachmentPreview {
  readonly kind: string
  readonly extractedText: string
}

async function prepareFiles(files: readonly string[]) {
  const handler = registeredHandler('attachments:prepare')
  if (!handler) {
    throw new Error('attachments:prepare handler was not registered')
  }

  return fromAny<ExtractedAttachmentPreview[], unknown>(await handler({}, '/tmp/repo', files))
}

describe('registerAttachmentHandlers extraction', () => {
  let registerAttachmentHandlers: Awaited<
    ReturnType<typeof loadAttachmentHandlers>
  >['registerAttachmentHandlers']

  beforeEach(async () => {
    resetAttachmentHandlerMocks()
    ;({ registerAttachmentHandlers } = await loadAttachmentHandlers())
  })

  it('prepares text attachments with extracted text and no binary source', async () => {
    registerFile('/tmp/repo/notes.txt', 'Hello from notes')

    registerAttachmentHandlers()
    const result = await prepareFiles(['/tmp/repo/notes.txt'])

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
    const result = await prepareFiles(['/tmp/repo/spec.pdf'])

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
    const result = await prepareFiles(['/tmp/repo/spec.pdf'])

    expect(result[0]).toMatchObject({ kind: 'pdf', extractedText: '' })
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
    const result = await prepareFiles(['/tmp/repo/screenshot.png'])

    expect(ocrRecognizeMock).toHaveBeenCalledOnce()
    expect(result[0]).toMatchObject({ kind: 'image', extractedText: 'OCR extracted text' })
    expect(result[0]).not.toHaveProperty('source')
  })

  it('logs and degrades gracefully when image OCR fails', async () => {
    registerFile('/tmp/repo/screenshot.png', Buffer.from('fake-image-data'))
    ocrRecognizeMock.mockRejectedValueOnce(new Error('ocr exploded'))

    registerAttachmentHandlers()
    const result = await prepareFiles(['/tmp/repo/screenshot.png'])

    expect(result[0]).toMatchObject({ kind: 'image', extractedText: '' })
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
    const result = await prepareFiles(['/tmp/repo/spec.docx'])

    expect(mammothExtractMock).toHaveBeenCalledOnce()
    expect(result[0]).toMatchObject({ kind: 'text', extractedText: 'Extracted DOCX text' })
    expect(result[0]).not.toHaveProperty('source')
  })

  it('logs and degrades gracefully when DOCX extraction fails', async () => {
    registerFile('/tmp/repo/spec.docx', Buffer.from('fake-docx-bytes'))
    mammothExtractMock.mockRejectedValueOnce(new Error('docx parser exploded'))

    registerAttachmentHandlers()
    const result = await prepareFiles(['/tmp/repo/spec.docx'])

    expect(result[0]).toMatchObject({ kind: 'text', extractedText: '' })
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
    const result = await prepareFiles(['/tmp/repo/spec.odt'])

    expect(jszipLoadAsyncMock).toHaveBeenCalledOnce()
    expect(result[0]).toMatchObject({ kind: 'text', extractedText: 'Hello ODT' })
    expect(result[0]).not.toHaveProperty('source')
  })

  it('logs and degrades gracefully when ODT extraction fails', async () => {
    registerFile('/tmp/repo/spec.odt', Buffer.from('fake-odt-bytes'))
    jszipLoadAsyncMock.mockRejectedValueOnce(new Error('odt parser exploded'))

    registerAttachmentHandlers()
    const result = await prepareFiles(['/tmp/repo/spec.odt'])

    expect(result[0]).toMatchObject({ kind: 'text', extractedText: '' })
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
    const result = await prepareFiles(['/tmp/repo/spec.rtf'])

    expect(result[0]).toMatchObject({ kind: 'text', extractedText: 'Hello\nworld' })
    expect(result[0]).not.toHaveProperty('source')
  })
})
