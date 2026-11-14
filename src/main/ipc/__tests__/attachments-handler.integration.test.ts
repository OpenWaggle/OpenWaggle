import { fromAny } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  jszipLoadAsyncMock,
  mammothExtractMock,
  ocrRecognizeMock,
  unpdfExtractTextMock,
} from './attachment-extraction-mocks.test-support'
import {
  attachmentsLoggerMock,
  loadAttachmentHandlers,
  registeredHandler,
  registerFile,
  resetAttachmentHandlerMocks,
  showMessageBoxMock,
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
      contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      extractedText: 'Hello from notes',
    })
    expect(result[0]).not.toHaveProperty('source')
    expect(showMessageBoxMock).not.toHaveBeenCalled()
  })

  it.each([
    ['PDF', '/tmp/repo/spec.pdf', unpdfExtractTextMock, 'pdf', 'Extracted PDF text'],
    ['image', '/tmp/repo/screenshot.png', ocrRecognizeMock, 'image', 'OCR extracted text'],
    ['DOCX', '/tmp/repo/spec.docx', mammothExtractMock, 'text', 'Extracted DOCX text'],
    ['ODT', '/tmp/repo/spec.odt', jszipLoadAsyncMock, 'text', 'Hello ODT'],
  ] as const)(
    'extracts the text of a %s attachment',
    async (_format, file, extractor, kind, text) => {
      registerFile(file, Buffer.from('fake-bytes'))

      registerAttachmentHandlers()
      const result = await prepareFiles([file])

      expect(extractor).toHaveBeenCalledOnce()
      expect(result[0]).toMatchObject({ kind, extractedText: text })
      expect(result[0]).not.toHaveProperty('source')
    },
  )

  it.each([
    ['/tmp/repo/spec.pdf', unpdfExtractTextMock, 'pdf', 'pdf'],
    ['/tmp/repo/screenshot.png', ocrRecognizeMock, 'image', 'image-ocr'],
    ['/tmp/repo/spec.docx', mammothExtractMock, 'text', 'docx'],
    ['/tmp/repo/spec.odt', jszipLoadAsyncMock, 'text', 'odt'],
  ] as const)(
    'logs and degrades gracefully when extracting %s fails',
    async (file, extractor, kind, extractorName) => {
      registerFile(file, Buffer.from('fake-bytes'))
      extractor.mockRejectedValueOnce(new Error(`${extractorName} exploded`))

      registerAttachmentHandlers()
      const result = await prepareFiles([file])

      expect(result[0]).toMatchObject({ kind, extractedText: '' })
      expect(attachmentsLoggerMock.warn).toHaveBeenCalledWith(
        'Attachment text extraction failed',
        expect.objectContaining({
          attachment: file.slice(file.lastIndexOf('/') + 1),
          extractor: extractorName,
          error: `${extractorName} exploded`,
        }),
      )
    },
  )

  it('extracts text from RTF attachments', async () => {
    registerFile('/tmp/repo/spec.rtf', '{\\rtf1\\ansi Hello\\par world}')

    registerAttachmentHandlers()
    const result = await prepareFiles(['/tmp/repo/spec.rtf'])

    expect(result[0]).toMatchObject({ kind: 'text', extractedText: 'Hello\nworld' })
    expect(result[0]).not.toHaveProperty('source')
  })
})
