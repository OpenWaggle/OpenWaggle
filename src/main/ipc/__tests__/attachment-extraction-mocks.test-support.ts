import { type Mock, vi } from 'vitest'

type UnpdfExtractTextMock = Mock<() => Promise<{ readonly text: string }>>
type MammothExtractMock = Mock<() => Promise<{ readonly value: string }>>
type OcrRecognizeMock = Mock<() => Promise<{ readonly data: { readonly text: string } }>>
type OcrTerminateMock = Mock<() => Promise<void>>
type ParserWorkerMock = Mock<(input: { readonly kind: string }) => Promise<string>>
type SharpMetadataMock = Mock<() => Promise<{ readonly height: number; readonly width: number }>>
type ValidateOfficeArchiveMock = Mock<() => Promise<void>>
interface ZipArchiveMock {
  readonly file: (name: string) => {
    readonly async: (format: string) => Promise<string>
  } | null
}
type JszipLoadAsyncMock = Mock<() => Promise<ZipArchiveMock>>

const attachmentExtractionMocks = vi.hoisted(() => ({
  unpdfExtractText: vi.fn<() => Promise<{ readonly text: string }>>(),
  ocrRecognize: vi.fn<() => Promise<{ readonly data: { readonly text: string } }>>(),
  ocrTerminate: vi.fn<() => Promise<void>>(),
  parserWorker: vi.fn<(input: { readonly kind: string }) => Promise<string>>(),
  sharpMetadata: vi.fn<() => Promise<{ readonly height: number; readonly width: number }>>(),
  validateOfficeArchive: vi.fn<() => Promise<void>>(),
  mammothExtract: vi.fn<() => Promise<{ readonly value: string }>>(),
  jszipLoadAsync: vi.fn<() => Promise<ZipArchiveMock>>(),
}))

vi.mock('unpdf', () => ({ extractText: attachmentExtractionMocks.unpdfExtractText }))
vi.mock('tesseract.js', () => ({
  createWorker: vi.fn(async () => ({
    recognize: attachmentExtractionMocks.ocrRecognize,
    terminate: attachmentExtractionMocks.ocrTerminate,
  })),
}))
vi.mock('sharp', () => ({
  default: vi.fn(() => ({ metadata: attachmentExtractionMocks.sharpMetadata })),
}))
vi.mock('mammoth', () => ({ extractRawText: attachmentExtractionMocks.mammothExtract }))
vi.mock('jszip', () => ({
  default: { loadAsync: attachmentExtractionMocks.jszipLoadAsync },
}))
vi.mock('../../utils/attachment-office-archive-validation', () => ({
  validateOfficeArchive: attachmentExtractionMocks.validateOfficeArchive,
}))
vi.mock('../../utils/attachment-parser-worker', () => ({
  runAttachmentParserWorker: attachmentExtractionMocks.parserWorker,
}))

export const unpdfExtractTextMock: UnpdfExtractTextMock = attachmentExtractionMocks.unpdfExtractText
export const ocrRecognizeMock: OcrRecognizeMock = attachmentExtractionMocks.ocrRecognize
export const ocrTerminateMock: OcrTerminateMock = attachmentExtractionMocks.ocrTerminate
export const parserWorkerMock: ParserWorkerMock = attachmentExtractionMocks.parserWorker
export const sharpMetadataMock: SharpMetadataMock = attachmentExtractionMocks.sharpMetadata
export const validateOfficeArchiveMock: ValidateOfficeArchiveMock =
  attachmentExtractionMocks.validateOfficeArchive
export const mammothExtractMock: MammothExtractMock = attachmentExtractionMocks.mammothExtract
export const jszipLoadAsyncMock: JszipLoadAsyncMock = attachmentExtractionMocks.jszipLoadAsync

export function resetAttachmentExtractionMocks() {
  unpdfExtractTextMock.mockReset()
  ocrRecognizeMock.mockReset()
  ocrTerminateMock.mockReset()
  parserWorkerMock.mockReset()
  sharpMetadataMock.mockReset()
  validateOfficeArchiveMock.mockReset()
  mammothExtractMock.mockReset()
  jszipLoadAsyncMock.mockReset()

  unpdfExtractTextMock.mockResolvedValue({ text: 'Extracted PDF text' })
  ocrRecognizeMock.mockResolvedValue({ data: { text: 'OCR extracted text' } })
  ocrTerminateMock.mockResolvedValue(undefined)
  sharpMetadataMock.mockResolvedValue({ height: 10, width: 10 })
  validateOfficeArchiveMock.mockResolvedValue(undefined)
  mammothExtractMock.mockResolvedValue({ value: 'Extracted DOCX text' })
  jszipLoadAsyncMock.mockResolvedValue({
    file: (name: string) =>
      name === 'content.xml'
        ? {
            async: async () => '<text:p>Hello ODT</text:p>',
          }
        : null,
  })
  parserWorkerMock.mockImplementation(async (input: { readonly kind: string }) => {
    if (input.kind === 'pdf') return (await unpdfExtractTextMock()).text
    if (input.kind === 'docx') return (await mammothExtractMock()).value
    if (input.kind === 'image') {
      await sharpMetadataMock()
      return (await ocrRecognizeMock()).data.text
    }
    const archive = await jszipLoadAsyncMock()
    const content = (await archive.file('content.xml')?.async('string')) ?? ''
    return content
      .replaceAll(/<[^>]+>/g, ' ')
      .replaceAll(/\s+/g, ' ')
      .trim()
  })
}
