import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { match, matchBy } from '@diegogbrisa/ts-match'
import { PERCENT_BASE } from '@shared/constants/math'
import { ATTACHMENT, BYTES_PER_KIBIBYTE } from '@shared/constants/resource-limits'
import { TIME_UNIT } from '@shared/constants/time'
import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import type { PreparedAttachment } from '@shared/types/agent'
import * as Effect from 'effect/Effect'
import { app } from 'electron'
import { createLogger } from '../logger'
import { rememberPreparedAttachment } from '../utils/attachment-registry'
import { broadcastToWindows } from '../utils/broadcast'
import { isPathInsideDirectory, validateRequiredProjectPath } from './project-path-validation'
import { typedHandle } from './typed-ipc'

const SLICE_ARG_1 = 2
const PARSE_INT_ARG_2 = 16
const PARSE_INT_ARG_2_VALUE_10 = 10

const logger = createLogger('ipc/attachments')

const MILLISECONDS_PER_HOUR =
  TIME_UNIT.SECONDS_PER_MINUTE * TIME_UNIT.SECONDS_PER_MINUTE * TIME_UNIT.MILLISECONDS_PER_SECOND
const TEMP_ATTACHMENT_RETENTION_MS = TIME_UNIT.HOURS_PER_DAY * MILLISECONDS_PER_HOUR
const TEMP_ATTACHMENTS_DIRECTORY_NAME = 'temp-attachments'
const TEMP_PROMPT_FILENAME_PREFIX = 'prompt-'
const TEMP_PROMPT_FILENAME_EXTENSION = '.md'
const TEMP_PROMPT_MIME_TYPE = 'text/markdown'
const TEMP_TEXT_ATTACHMENT_WRITE_CHUNK_BYTES = 32 * BYTES_PER_KIBIBYTE
const TEXT_ATTACHMENT_MAX_SIZE_MB =
  ATTACHMENT.MAX_SIZE_BYTES / (BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE)
const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const RTF_MIME_TYPE = 'application/rtf'
const ODT_MIME_TYPE = 'application/vnd.oasis.opendocument.text'
const TEMP_PROMPT_FILENAME_PATTERN = /^prompt-\d+\.md$/

const prepareArgsSchema = Schema.Struct({
  projectPath: Schema.String.pipe(Schema.minLength(1)),
  paths: Schema.Array(Schema.String).pipe(Schema.maxItems(ATTACHMENT.MAX_COUNT)),
})
const prepareFromTextArgsSchema = Schema.Struct({
  text: Schema.String.pipe(Schema.minLength(1)),
  operationId: Schema.String.pipe(Schema.minLength(1)),
})

function buildTempPromptFilename(timestamp: number): string {
  return `${TEMP_PROMPT_FILENAME_PREFIX}${String(timestamp)}${TEMP_PROMPT_FILENAME_EXTENSION}`
}

function describeUnknownError(error: unknown): { message: string } {
  if (error instanceof Error) {
    return { message: error.message }
  }

  return { message: String(error) }
}

async function withExtractionFallback(
  attachmentName: string,
  extractor: string,
  extractText: () => Promise<string>,
): Promise<string> {
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

async function ensureTempAttachmentsDirectory(): Promise<string> {
  const tempAttachmentsDir = path.join(app.getPath('userData'), TEMP_ATTACHMENTS_DIRECTORY_NAME)
  await fs.mkdir(tempAttachmentsDir, { recursive: true })
  return tempAttachmentsDir
}

async function cleanupTempAttachments(): Promise<void> {
  const tempAttachmentsDir = await ensureTempAttachmentsDirectory()
  const entries = await fs.readdir(tempAttachmentsDir)
  if (entries.length === 0) return

  const staleBefore = Date.now() - TEMP_ATTACHMENT_RETENTION_MS
  for (const entry of entries) {
    if (!TEMP_PROMPT_FILENAME_PATTERN.test(entry)) continue

    const filePath = path.join(tempAttachmentsDir, entry)
    try {
      const stats = await fs.stat(filePath)
      if (!stats.isFile()) continue
      if (stats.mtimeMs >= staleBefore) continue
      await fs.unlink(filePath)
    } catch (error) {
      logger.warn(
        `Failed to clean up stale prompt attachment: ${entry}`,
        describeUnknownError(error),
      )
    }
  }
}

function emitPrepareFromTextProgress(payload: {
  operationId: string
  bytesWritten: number
  totalBytes: number
  progressPercent: number
  stage: 'writing' | 'completed'
}): void {
  broadcastToWindows('attachments:prepare-from-text-progress', payload)
}

function toProgressPercent(bytesWritten: number, totalBytes: number): number {
  if (totalBytes <= 0) return PERCENT_BASE
  const percent = Math.round((bytesWritten / totalBytes) * PERCENT_BASE)
  return Math.max(0, Math.min(PERCENT_BASE, percent))
}

async function writePromptTextFileWithProgress(
  filePath: string,
  text: string,
  operationId: string,
): Promise<void> {
  const encodedText = Buffer.from(text, 'utf8')
  const totalBytes = encodedText.byteLength
  let bytesWritten = 0
  const fileHandle = await fs.open(filePath, 'w')
  emitPrepareFromTextProgress({
    operationId,
    bytesWritten,
    totalBytes,
    progressPercent: toProgressPercent(bytesWritten, totalBytes),
    stage: 'writing',
  })

  try {
    while (bytesWritten < totalBytes) {
      const remainingBytes = totalBytes - bytesWritten
      const chunkBytes = Math.min(TEMP_TEXT_ATTACHMENT_WRITE_CHUNK_BYTES, remainingBytes)
      const result = await fileHandle.write(encodedText, bytesWritten, chunkBytes, bytesWritten)
      bytesWritten += result.bytesWritten
      emitPrepareFromTextProgress({
        operationId,
        bytesWritten,
        totalBytes,
        progressPercent: toProgressPercent(bytesWritten, totalBytes),
        stage: 'writing',
      })
    }
  } finally {
    await fileHandle.close()
  }

  emitPrepareFromTextProgress({
    operationId,
    bytesWritten: totalBytes,
    totalBytes,
    progressPercent: PERCENT_BASE,
    stage: 'completed',
  })
}

function resolveAttachmentKind(mimeType: string): PreparedAttachment['kind'] {
  if (mimeType === 'application/pdf') return 'pdf'
  if (mimeType.startsWith('image/')) return 'image'
  return 'text'
}

function guessMimeType(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase()
  return matchBy({ ext }, 'ext')
    .partial((group) => [
      group('.pdf', () => 'application/pdf'),
      group('.png', () => 'image/png'),
      group('.jpg', '.jpeg', () => 'image/jpeg'),
      group('.webp', () => 'image/webp'),
      group('.gif', () => 'image/gif'),
      group('.bmp', () => 'image/bmp'),
      group('.svg', () => 'image/svg+xml'),
      group('.md', () => 'text/markdown'),
      group('.json', () => 'application/json'),
      group('.yaml', '.yml', () => 'application/yaml'),
      group('.xml', () => 'application/xml'),
      group('.csv', () => 'text/csv'),
      group('.log', () => 'text/plain'),
      group('.docx', () => DOCX_MIME_TYPE),
      group('.rtf', () => RTF_MIME_TYPE),
      group('.odt', () => ODT_MIME_TYPE),
      group(
        '.ts',
        '.tsx',
        '.js',
        '.jsx',
        '.mjs',
        '.cjs',
        '.py',
        '.java',
        '.go',
        '.rs',
        '.swift',
        '.kt',
        '.css',
        '.scss',
        '.sass',
        '.less',
        '.html',
        '.htm',
        '.txt',
        () => 'text/plain',
      ),
    ])
    .otherwise(() => null)
}

function normalizeText(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length <= ATTACHMENT.MAX_EXTRACTED_TEXT_CHARS) return trimmed
  return `${trimmed.slice(0, ATTACHMENT.MAX_EXTRACTED_TEXT_CHARS)}\n...[truncated]`
}

function decodeXmlEntities(value: string): string {
  return value.replaceAll(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_raw, entity: string): string => {
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

function extractTextFromRtf(raw: string): string {
  const withParagraphs = raw.replaceAll(/\\par[d]?/g, '\n')
  const withoutHexEscapes = withParagraphs.replaceAll(/\\'[0-9a-fA-F]{2}/g, '')
  const withoutControls = withoutHexEscapes.replaceAll(/\\[a-z]+-?\d* ?/g, '')
  const withoutGroups = withoutControls.replaceAll(/[{}]/g, '')
  const withoutIndentedBreaks = withoutGroups.replaceAll(/\n\s+/g, '\n')
  return normalizeText(withoutIndentedBreaks.replaceAll(/\n{3,}/g, '\n\n'))
}

// TODO: replace mammoth with actively maintained alternative when available
async function extractTextFromDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ buffer })
  return normalizeText(result.value ?? '')
}

async function extractTextFromOdt(buffer: Buffer): Promise<string> {
  const JSZip = (await import('jszip')).default
  const archive = await JSZip.loadAsync(buffer)
  const content = await archive.file('content.xml')?.async('string')
  if (!content) return ''
  const withoutTags = content.replaceAll(/<[^>]+>/g, ' ')
  const decoded = decodeXmlEntities(withoutTags)
  const normalizedWhitespace = decoded.replaceAll(/\s+/g, ' ')
  return normalizeText(normalizedWhitespace)
}

async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const { extractText } = await import('unpdf')
  const result = await extractText(new Uint8Array(buffer), { mergePages: true })
  return normalizeText(result.text ?? '')
}

async function extractTextFromImage(buffer: Buffer): Promise<string> {
  const tesseract = await import('tesseract.js')
  const result = await tesseract.recognize(buffer, 'eng')
  return normalizeText(result.data.text ?? '')
}

async function prepareAttachment(filePath: string): Promise<PreparedAttachment> {
  const stats = await fs.stat(filePath)
  if (!stats.isFile()) {
    throw new Error(`Not a file: ${filePath}`)
  }
  if (stats.size > ATTACHMENT.MAX_SIZE_BYTES) {
    throw new Error(
      `Attachment exceeds ${String(ATTACHMENT.MAX_SIZE_BYTES / (BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE))} MB: ${path.basename(filePath)}`,
    )
  }

  const mimeType = guessMimeType(filePath)
  if (!mimeType) {
    throw new Error(
      `Unsupported attachment type: ${path.basename(filePath)}. Supported: text files, images, PDFs.`,
    )
  }
  const buffer = await fs.readFile(filePath)
  const kind = resolveAttachmentKind(mimeType)
  const attachmentName = path.basename(filePath)

  const extractedText = await match(kind)
    .with('pdf', () =>
      withExtractionFallback(attachmentName, 'pdf', () => extractTextFromPdf(buffer)),
    )
    .with('image', () =>
      withExtractionFallback(attachmentName, 'image-ocr', () => extractTextFromImage(buffer)),
    )
    .otherwise(() =>
      match(mimeType)
        .with(DOCX_MIME_TYPE, () =>
          withExtractionFallback(attachmentName, 'docx', () => extractTextFromDocx(buffer)),
        )
        .with(ODT_MIME_TYPE, () =>
          withExtractionFallback(attachmentName, 'odt', () => extractTextFromOdt(buffer)),
        )
        .with(RTF_MIME_TYPE, () => Promise.resolve(extractTextFromRtf(buffer.toString('utf8'))))
        .otherwise(() => Promise.resolve(normalizeText(buffer.toString('utf8')))),
    )

  return {
    id: randomUUID(),
    kind,
    origin: 'user-file',
    name: path.basename(filePath),
    path: filePath,
    mimeType,
    sizeBytes: stats.size,
    extractedText,
  }
}

export { hydrateAttachmentSources } from '../utils/attachment-hydration'

export function registerAttachmentHandlers(): void {
  void cleanupTempAttachments().catch((error: unknown) => {
    logger.warn('Temp prompt attachment cleanup failed during startup', describeUnknownError(error))
  })

  typedHandle('attachments:prepare', (_event, rawProjectPath: unknown, rawPaths: unknown) =>
    Effect.gen(function* () {
      const { projectPath: pp, paths } = decodeUnknownOrThrow(prepareArgsSchema, {
        projectPath: rawProjectPath,
        paths: rawPaths,
      })

      const projectPath = yield* validateRequiredProjectPath(pp)

      const normalized = paths
        .map((entry) => (path.isAbsolute(entry) ? entry : path.resolve(projectPath, entry)))
        .map((entry) => path.normalize(entry))

      const uniquePaths = [...new Set(normalized)]
      if (uniquePaths.length === 0) return []
      if (uniquePaths.length > ATTACHMENT.MAX_COUNT) {
        return yield* Effect.fail(
          new Error(
            `A maximum of ${String(ATTACHMENT.MAX_COUNT)} attachments is supported per message.`,
          ),
        )
      }

      const resolvedPaths = yield* Effect.promise(() =>
        Promise.all(uniquePaths.map((filePath) => fs.realpath(filePath))),
      )
      const outsideProjectPath = resolvedPaths.find(
        (filePath) => !isPathInsideDirectory(projectPath, filePath),
      )
      if (outsideProjectPath) {
        return yield* Effect.fail(new Error('Attachments must be inside the selected project.'))
      }

      const stats = yield* Effect.promise(() =>
        Promise.all(resolvedPaths.map((filePath) => fs.stat(filePath))),
      )
      const totalSize = stats.reduce((sum, stat) => sum + stat.size, 0)
      if (totalSize > ATTACHMENT.MAX_TOTAL_SIZE_BYTES) {
        return yield* Effect.fail(
          new Error(
            `Total attachment size exceeds ${String(ATTACHMENT.MAX_TOTAL_SIZE_BYTES / (BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE))} MB.`,
          ),
        )
      }

      const prepared: PreparedAttachment[] = []
      for (const filePath of resolvedPaths) {
        const attachment = yield* Effect.promise(() => prepareAttachment(filePath))
        rememberPreparedAttachment(attachment, filePath)
        prepared.push(attachment)
      }
      return prepared
    }),
  )

  typedHandle(
    'attachments:prepare-from-text',
    (_event, rawText: unknown, rawOperationId: unknown) =>
      Effect.gen(function* () {
        const { text, operationId } = decodeUnknownOrThrow(prepareFromTextArgsSchema, {
          text: rawText,
          operationId: rawOperationId,
        })
        const sizeBytes = Buffer.byteLength(text, 'utf8')
        if (sizeBytes > ATTACHMENT.MAX_SIZE_BYTES) {
          return yield* Effect.fail(
            new Error(`Generated attachment exceeds ${String(TEXT_ATTACHMENT_MAX_SIZE_MB)} MB.`),
          )
        }

        const tempAttachmentsDir = yield* Effect.promise(() => ensureTempAttachmentsDirectory())
        const fileName = buildTempPromptFilename(Date.now())
        const filePath = path.join(tempAttachmentsDir, fileName)

        yield* Effect.promise(() => writePromptTextFileWithProgress(filePath, text, operationId))
        const stats = yield* Effect.promise(() => fs.stat(filePath))
        if (!stats.isFile()) {
          return yield* Effect.fail(
            new Error(`Temporary prompt attachment is not a file: ${fileName}`),
          )
        }

        const attachment: PreparedAttachment = {
          id: randomUUID(),
          kind: 'text',
          origin: 'auto-paste-text',
          name: fileName,
          path: filePath,
          mimeType: TEMP_PROMPT_MIME_TYPE,
          sizeBytes: stats.size,
          extractedText: text,
        }
        rememberPreparedAttachment(attachment, filePath)
        return attachment
      }),
  )
}
