import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { match } from '@diegogbrisa/ts-match'
import { ATTACHMENT } from '@shared/constants/resource-limits'
import { createLogger } from '../logger'
import {
  attachmentExtractionTimeoutError,
  scheduleAttachmentExtraction,
} from './attachment-extraction-scheduler'
import { validateOfficeArchive } from './attachment-office-archive-validation'
import { runAttachmentParserWorker } from './attachment-parser-worker'

const SLICE_ARG_1 = 2
const PARSE_INT_ARG_2 = 16
const PARSE_INT_ARG_2_VALUE_10 = 10
export const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const RTF_MIME_TYPE = 'application/rtf'
export const ODT_MIME_TYPE = 'application/vnd.oasis.opendocument.text'

const logger = createLogger('attachments')

function importSharpModule() {
  return import('sharp')
}

function importTesseractModule() {
  return import('tesseract.js')
}

let sharpModulePromise: ReturnType<typeof importSharpModule> | undefined
let tesseractModulePromise: ReturnType<typeof importTesseractModule> | undefined

function assertExtractionActive(signal: AbortSignal) {
  if (signal.aborted) throw attachmentExtractionTimeoutError()
}

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
async function extractTextFromDocx(buffer: Buffer, signal: AbortSignal) {
  await validateOfficeArchive(buffer, signal)
  assertExtractionActive(signal)
  return normalizeText(await runAttachmentParserWorker({ kind: 'docx', buffer }, signal))
}

async function extractTextFromOdt(buffer: Buffer, signal: AbortSignal) {
  await validateOfficeArchive(buffer, signal)
  assertExtractionActive(signal)
  const content = await runAttachmentParserWorker({ kind: 'odt', buffer }, signal)
  if (!content) return ''
  const withoutTags = content.replaceAll(/<[^>]+>/g, ' ')
  const decoded = decodeXmlEntities(withoutTags)
  const normalizedWhitespace = decoded.replaceAll(/\s+/g, ' ')
  return normalizeText(normalizedWhitespace)
}

async function extractTextFromPdf(buffer: Buffer, signal: AbortSignal) {
  assertExtractionActive(signal)
  return normalizeText(await runAttachmentParserWorker({ kind: 'pdf', buffer }, signal))
}

async function extractTextFromImage(buffer: Buffer, signal: AbortSignal) {
  sharpModulePromise ??= importSharpModule()
  const sharp = (await sharpModulePromise).default
  const metadata = await sharp(buffer, {
    limitInputPixels: ATTACHMENT.MAX_IMAGE_PIXELS,
  }).metadata()
  if (!metadata.width || !metadata.height) {
    throw new Error('Image dimensions could not be determined safely.')
  }
  if (metadata.width * metadata.height > ATTACHMENT.MAX_IMAGE_PIXELS) {
    throw new Error(`Image exceeds the ${String(ATTACHMENT.MAX_IMAGE_PIXELS)} pixel OCR limit.`)
  }
  assertExtractionActive(signal)
  tesseractModulePromise ??= importTesseractModule()
  const tesseract = await tesseractModulePromise
  const cachePath = path.join(os.tmpdir(), 'openwaggle-tesseract-cache')
  await fs.mkdir(cachePath, { recursive: true })
  assertExtractionActive(signal)
  const worker = await tesseract.createWorker('eng', undefined, { cachePath })
  if (signal.aborted) {
    await worker.terminate()
    throw attachmentExtractionTimeoutError()
  }
  let termination: ReturnType<typeof worker.terminate> | undefined
  const terminateWorker = () => {
    termination ??= worker.terminate()
    return termination
  }
  const terminateWorkerOnAbort = () => {
    void terminateWorker()
  }
  signal.addEventListener('abort', terminateWorkerOnAbort, { once: true })
  try {
    const result = await worker.recognize(buffer)
    return normalizeText(result.data.text ?? '')
  } finally {
    signal.removeEventListener('abort', terminateWorkerOnAbort)
    await terminateWorker()
  }
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
