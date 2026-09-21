import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import { ATTACHMENT } from '@shared/constants/resource-limits'
import { attachmentExtractionTimeoutError } from './attachment-extraction-scheduler'

export type AttachmentParserKind = 'docx' | 'image' | 'odt' | 'pdf' | 'rtf'

interface ParserWorkerMessage {
  readonly ok: boolean
  readonly text?: string
  readonly error?: string
}

export interface AttachmentParserWorkerPort {
  once(event: 'message', listener: (message: unknown) => void): this
  once(event: 'error', listener: (error: Error) => void): this
  once(event: 'exit', listener: (code: number) => void): this
  off(event: 'message', listener: (message: unknown) => void): this
  off(event: 'error', listener: (error: Error) => void): this
  off(event: 'exit', listener: (code: number) => void): this
  terminate(): Promise<number>
}

type ParserWorkerFactory = (input: {
  readonly kind: AttachmentParserKind
  readonly buffer: Buffer
}) => AttachmentParserWorkerPort

const PARSER_MAX_OLD_GENERATION_MB = 128
const PARSER_MAX_YOUNG_GENERATION_MB = 32
const PARSER_STACK_MB = 4
const resolveParserDependency = createRequire(__filename).resolve
const PARSER_MODULE_URLS = {
  mammoth: pathToFileURL(resolveParserDependency('mammoth')).href,
  jszip: pathToFileURL(resolveParserDependency('jszip')).href,
  sharp: pathToFileURL(resolveParserDependency('sharp')).href,
  tesseract: pathToFileURL(resolveParserDependency('tesseract.js')).href,
  unpdf: pathToFileURL(resolveParserDependency('unpdf')).href,
} as const

const ATTACHMENT_PARSER_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads')
const fs = require('node:fs/promises')

function normalizeText(value) {
  const trimmed = value.trim()
  if (trimmed.length <= workerData.maxExtractedTextChars) return trimmed
  const marker = '\n...[truncated]'
  return trimmed.slice(0, Math.max(0, workerData.maxExtractedTextChars - marker.length)) + marker
}

function decodeXmlEntities(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_raw, entity) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const codePoint = Number.parseInt(entity.slice(2), 16)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : ''
    }
    if (entity.startsWith('#')) {
      const codePoint = Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : ''
    }
    return named[entity] || ''
  })
}

function normalizeOdt(content) {
  return normalizeText(decodeXmlEntities(content.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' '))
}

function normalizeRtf(raw) {
  const withParagraphs = raw.replace(/\\par[d]?/g, '\n')
  const withoutHexEscapes = withParagraphs.replace(/\\'[0-9a-fA-F]{2}/g, '')
  const withoutControls = withoutHexEscapes.replace(/\\[a-z]+-?\d* ?/g, '')
  const withoutGroups = withoutControls.replace(/[{}]/g, '')
  const withoutIndentedBreaks = withoutGroups.replace(/\n\s+/g, '\n')
  return normalizeText(withoutIndentedBreaks.replace(/\n{3,}/g, '\n\n'))
}

async function parse() {
  const buffer = Buffer.from(workerData.buffer)
  if (workerData.kind === 'rtf') return normalizeRtf(buffer.toString('utf8'))
  if (workerData.kind === 'docx') {
    const mammoth = await import(workerData.moduleUrls.mammoth)
    const result = await mammoth.extractRawText({ buffer })
    return normalizeText(result.value || '')
  }
  if (workerData.kind === 'odt') {
    const JSZip = (await import(workerData.moduleUrls.jszip)).default
    const archive = await JSZip.loadAsync(buffer)
    const content = (await archive.file('content.xml')?.async('string')) || ''
    return normalizeOdt(content)
  }
  if (workerData.kind === 'image') {
    const sharp = (await import(workerData.moduleUrls.sharp)).default
    const image = sharp(buffer, {
      limitInputPixels: workerData.maxImagePixels,
    })
    const metadata = await image.metadata()
    if (!metadata.width || !metadata.height) {
      throw new Error('Image dimensions could not be determined safely.')
    }
    if (metadata.width * metadata.height > workerData.maxImagePixels) {
      throw new Error('Image exceeds the OCR pixel limit.')
    }
    const sourcePixels = metadata.width * metadata.height
    const ocrBuffer = sourcePixels > workerData.maxOcrImagePixels
      ? await image.resize({
          fit: 'inside',
          height: Math.max(
            1,
            Math.floor(metadata.height * Math.sqrt(workerData.maxOcrImagePixels / sourcePixels)),
          ),
          width: Math.max(
            1,
            Math.floor(metadata.width * Math.sqrt(workerData.maxOcrImagePixels / sourcePixels)),
          ),
          withoutEnlargement: true,
        }).png().toBuffer()
      : buffer
    await fs.mkdir(workerData.ocrCachePath, { recursive: true, mode: 0o700 })
    const cacheStats = await fs.lstat(workerData.ocrCachePath)
    if (!cacheStats.isDirectory() || cacheStats.isSymbolicLink()) {
      throw new Error('OCR cache path is not a secure directory.')
    }
    if (typeof process.getuid === 'function' && cacheStats.uid !== process.getuid()) {
      throw new Error('OCR cache directory is not owned by the current user.')
    }
    await fs.chmod(workerData.ocrCachePath, 0o700)
    const tesseract = await import(workerData.moduleUrls.tesseract)
    const worker = await tesseract.createWorker('eng', undefined, {
      cachePath: workerData.ocrCachePath,
    })
    try {
      const result = await worker.recognize(ocrBuffer)
      return normalizeText(result.data.text || '')
    } finally {
      await worker.terminate()
    }
  }
  const { extractText } = await import(workerData.moduleUrls.unpdf)
  const result = await extractText(new Uint8Array(buffer), { mergePages: true })
  return normalizeText(result.text || '')
}

parse().then(
  (text) => parentPort.postMessage({ ok: true, text }),
  (error) => parentPort.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }),
)
`

const createParserWorker: ParserWorkerFactory = (input) =>
  new Worker(ATTACHMENT_PARSER_WORKER_SOURCE, {
    eval: true,
    workerData: {
      ...input,
      moduleUrls: PARSER_MODULE_URLS,
      maxExtractedTextChars: ATTACHMENT.MAX_EXTRACTED_TEXT_CHARS,
      maxImagePixels: ATTACHMENT.MAX_IMAGE_PIXELS,
      maxOcrImagePixels: ATTACHMENT.MAX_OCR_IMAGE_PIXELS,
      ocrCachePath: path.join(os.homedir(), '.openwaggle', 'cache', 'tesseract'),
    },
    resourceLimits: {
      maxOldGenerationSizeMb: PARSER_MAX_OLD_GENERATION_MB,
      maxYoungGenerationSizeMb: PARSER_MAX_YOUNG_GENERATION_MB,
      stackSizeMb: PARSER_STACK_MB,
    },
  })

function parserWorkerMessage(value: unknown): ParserWorkerMessage | undefined {
  if (typeof value !== 'object' || value === null || !('ok' in value)) return undefined
  if (value.ok === true && 'text' in value && typeof value.text === 'string') {
    return { ok: true, text: value.text }
  }
  if (value.ok === false && 'error' in value && typeof value.error === 'string') {
    return { ok: false, error: value.error }
  }
  return undefined
}

export function runAttachmentParserWorker(
  input: { readonly kind: AttachmentParserKind; readonly buffer: Buffer },
  signal: AbortSignal,
  workerFactory: ParserWorkerFactory = createParserWorker,
) {
  return new Promise<string>((resolve, reject) => {
    const worker = workerFactory(input)
    let settled = false
    let aborting = false
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort)
      worker.off('message', onMessage)
      worker.off('error', onError)
      worker.off('exit', onExit)
    }
    const finish = (complete: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      complete()
    }
    const onMessage = (value: unknown) => {
      const message = parserWorkerMessage(value)
      if (!message) {
        finish(() => reject(new Error('Attachment parser worker returned an invalid response.')))
        return
      }
      finish(() =>
        message.ok
          ? resolve(message.text ?? '')
          : reject(new Error(message.error ?? 'Attachment parser failed.')),
      )
    }
    const onError = (error: Error) => finish(() => reject(error))
    const onExit = (code: number) => {
      if (aborting) return
      finish(() =>
        reject(
          code === 0
            ? new Error('Attachment parser worker exited without a response.')
            : new Error(`Attachment parser worker exited with code ${String(code)}.`),
        ),
      )
    }
    const onAbort = () => {
      if (aborting) return
      aborting = true
      void worker.terminate().then(
        () => finish(() => reject(attachmentExtractionTimeoutError())),
        (error: unknown) =>
          finish(() => reject(error instanceof Error ? error : new Error(String(error)))),
      )
    }
    worker.once('message', onMessage)
    worker.once('error', onError)
    worker.once('exit', onExit)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
  })
}
