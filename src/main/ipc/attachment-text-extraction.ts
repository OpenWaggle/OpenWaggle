import { match } from '@diegogbrisa/ts-match'
import { ATTACHMENT } from '@shared/constants/resource-limits'
import { createLogger } from '../logger'

const SLICE_ARG_1 = 2
const PARSE_INT_ARG_2 = 16
const PARSE_INT_ARG_2_VALUE_10 = 10
export const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const RTF_MIME_TYPE = 'application/rtf'
export const ODT_MIME_TYPE = 'application/vnd.oasis.opendocument.text'

const logger = createLogger('ipc/attachments')

function describeUnknownError(error: unknown) {
  if (error instanceof Error) {
    return { message: error.message }
  }

  return { message: String(error) }
}

async function withExtractionFallback(
  attachmentName: string,
  extractor: string,
  extractText: () => Promise<string>,
) {
  try {
    return await extractText()
  } catch (error) {
    logger.warn('Attachment text extraction failed', {
      attachment: attachmentName,
      extractor,
      error: describeUnknownError(error).message,
    })
    return ''
  }
}

function normalizeText(value: string) {
  const trimmed = value.trim()
  if (trimmed.length <= ATTACHMENT.MAX_EXTRACTED_TEXT_CHARS) return trimmed
  return `${trimmed.slice(0, ATTACHMENT.MAX_EXTRACTED_TEXT_CHARS)}\n...[truncated]`
}

function decodeXmlEntities(value: string) {
  return value.replaceAll(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_raw, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const codePoint = Number.parseInt(entity.slice(SLICE_ARG_1), PARSE_INT_ARG_2)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : ''
    }
    if (entity.startsWith('#')) {
      const codePoint = Number.parseInt(entity.slice(1), PARSE_INT_ARG_2_VALUE_10)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : ''
    }

    return match(entity)
      .with('amp', () => '&')
      .with('lt', () => '<')
      .with('gt', () => '>')
      .with('quot', () => '"')
      .with('apos', () => "'")
      .otherwise(() => '')
  })
}

function extractTextFromRtf(raw: string) {
  const withParagraphs = raw.replaceAll(/\\par[d]?/g, '\n')
  const withoutHexEscapes = withParagraphs.replaceAll(/\\'[0-9a-fA-F]{2}/g, '')
  const withoutControls = withoutHexEscapes.replaceAll(/\\[a-z]+-?\d* ?/g, '')
  const withoutGroups = withoutControls.replaceAll(/[{}]/g, '')
  const withoutIndentedBreaks = withoutGroups.replaceAll(/\n\s+/g, '\n')
  return normalizeText(withoutIndentedBreaks.replaceAll(/\n{3,}/g, '\n\n'))
}
async function extractTextFromDocx(buffer: Buffer) {
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ buffer })
  return normalizeText(result.value ?? '')
}

async function extractTextFromOdt(buffer: Buffer) {
  const JSZip = (await import('jszip')).default
  const archive = await JSZip.loadAsync(buffer)
  const content = await archive.file('content.xml')?.async('string')
  if (!content) return ''
  const withoutTags = content.replaceAll(/<[^>]+>/g, ' ')
  const decoded = decodeXmlEntities(withoutTags)
  const normalizedWhitespace = decoded.replaceAll(/\s+/g, ' ')
  return normalizeText(normalizedWhitespace)
}

async function extractTextFromPdf(buffer: Buffer) {
  const { extractText } = await import('unpdf')
  const result = await extractText(new Uint8Array(buffer), { mergePages: true })
  return normalizeText(result.text ?? '')
}

async function extractTextFromImage(buffer: Buffer) {
  const tesseract = await import('tesseract.js')
  const result = await tesseract.recognize(buffer, 'eng')
  return normalizeText(result.data.text ?? '')
}

export async function extractAttachmentText(input: {
  readonly kind: string
  readonly mimeType: string
  readonly buffer: Buffer
  readonly attachmentName: string
}) {
  return match(input.kind)
    .with('pdf', () =>
      withExtractionFallback(input.attachmentName, 'pdf', () => extractTextFromPdf(input.buffer)),
    )
    .with('image', () =>
      withExtractionFallback(input.attachmentName, 'image-ocr', () =>
        extractTextFromImage(input.buffer),
      ),
    )
    .otherwise(() =>
      match(input.mimeType)
        .with(DOCX_MIME_TYPE, () =>
          withExtractionFallback(input.attachmentName, 'docx', () =>
            extractTextFromDocx(input.buffer),
          ),
        )
        .with(ODT_MIME_TYPE, () =>
          withExtractionFallback(input.attachmentName, 'odt', () =>
            extractTextFromOdt(input.buffer),
          ),
        )
        .with(RTF_MIME_TYPE, () =>
          Promise.resolve(extractTextFromRtf(input.buffer.toString('utf8'))),
        )
        .otherwise(() => Promise.resolve(normalizeText(input.buffer.toString('utf8')))),
    )
}
