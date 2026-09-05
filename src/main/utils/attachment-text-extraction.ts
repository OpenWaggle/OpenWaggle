import { match } from '@diegogbrisa/ts-match'
import { ATTACHMENT } from '@shared/constants/resource-limits'
import { createLogger } from '../logger'
import { scheduleAttachmentExtraction } from './attachment-extraction-scheduler'
import { validateOfficeArchive } from './attachment-office-archive-validation'
import { runAttachmentParserWorker } from './attachment-parser-worker'

export const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const RTF_MIME_TYPE = 'application/rtf'
export const ODT_MIME_TYPE = 'application/vnd.oasis.opendocument.text'

const logger = createLogger('attachments')

function describeUnknownError(error: unknown) {
  if (error instanceof Error) {
    return { message: error.message }
  }

  return { message: String(error) }
}

async function withExtractionFallback(
  attachmentName: string,
  extractor: string,
  extractText: (signal: AbortSignal) => Promise<string>,
) {
  try {
    return await scheduleAttachmentExtraction(extractText)
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

function extractTextFromRtf(raw: string) {
  const withParagraphs = raw.replaceAll(/\\par[d]?/g, '\n')
  const withoutHexEscapes = withParagraphs.replaceAll(/\\'[0-9a-fA-F]{2}/g, '')
  const withoutControls = withoutHexEscapes.replaceAll(/\\[a-z]+-?\d* ?/g, '')
  const withoutGroups = withoutControls.replaceAll(/[{}]/g, '')
  const withoutIndentedBreaks = withoutGroups.replaceAll(/\n\s+/g, '\n')
  return normalizeText(withoutIndentedBreaks.replaceAll(/\n{3,}/g, '\n\n'))
}
async function extractTextFromDocx(buffer: Buffer, signal: AbortSignal) {
  await validateOfficeArchive(buffer, signal)
  return normalizeText(await runAttachmentParserWorker({ kind: 'docx', buffer }, signal))
}

async function extractTextFromOdt(buffer: Buffer, signal: AbortSignal) {
  await validateOfficeArchive(buffer, signal)
  return normalizeText(await runAttachmentParserWorker({ kind: 'odt', buffer }, signal))
}

async function extractTextFromPdf(buffer: Buffer, signal: AbortSignal) {
  return normalizeText(await runAttachmentParserWorker({ kind: 'pdf', buffer }, signal))
}

async function extractTextFromImage(buffer: Buffer, signal: AbortSignal) {
  return normalizeText(await runAttachmentParserWorker({ kind: 'image', buffer }, signal))
}

export async function extractAttachmentText(input: {
  readonly kind: string
  readonly mimeType: string
  readonly buffer: Buffer
  readonly attachmentName: string
}) {
  return match(input.kind)
    .with('pdf', () =>
      withExtractionFallback(input.attachmentName, 'pdf', (signal) =>
        extractTextFromPdf(input.buffer, signal),
      ),
    )
    .with('image', () =>
      withExtractionFallback(input.attachmentName, 'image-ocr', (signal) =>
        extractTextFromImage(input.buffer, signal),
      ),
    )
    .otherwise(() =>
      match(input.mimeType)
        .with(DOCX_MIME_TYPE, () =>
          withExtractionFallback(input.attachmentName, 'docx', (signal) =>
            extractTextFromDocx(input.buffer, signal),
          ),
        )
        .with(ODT_MIME_TYPE, () =>
          withExtractionFallback(input.attachmentName, 'odt', (signal) =>
            extractTextFromOdt(input.buffer, signal),
          ),
        )
        .with(RTF_MIME_TYPE, () =>
          Promise.resolve(extractTextFromRtf(input.buffer.toString('utf8'))),
        )
        .otherwise(() => Promise.resolve(normalizeText(input.buffer.toString('utf8')))),
    )
}
