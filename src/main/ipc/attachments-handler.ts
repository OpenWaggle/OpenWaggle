import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  BYTES_PER_KIBIBYTE,
  HOURS_PER_DAY,
  MILLISECONDS_PER_SECOND,
  PERCENT_BASE,
  SECONDS_PER_MINUTE,
} from '@shared/constants/constants'
import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import type { HydratedAttachment, PreparedAttachment } from '@shared/types/agent'
import { choose } from '@shared/utils/decision'
import { isPathInside } from '@shared/utils/paths'
import { app, dialog } from 'electron'
import { createLogger } from '../logger'
import { broadcastToWindows } from '../utils/broadcast'
import { safeHandle } from './typed-ipc'

const MODULE_VALUE_8 = 8
const MODULE_VALUE_20 = 20
const SLICE_ARG_1 = 2
const PARSE_INT_ARG_2 = 16
const PARSE_INT_ARG_2_VALUE_10 = 10

const logger = createLogger('ipc/attachments')

const MAX_ATTACHMENTS = 5
const MAX_ATTACHMENT_SIZE_BYTES = MODULE_VALUE_8 * BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE
const MAX_TOTAL_SIZE_BYTES = MODULE_VALUE_20 * BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE
const MAX_EXTRACTED_TEXT_CHARS = 12_000
const MILLISECONDS_PER_HOUR = SECONDS_PER_MINUTE * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND
const TEMP_ATTACHMENT_RETENTION_MS = HOURS_PER_DAY * MILLISECONDS_PER_HOUR
const TEMP_ATTACHMENTS_DIRECTORY_NAME = 'temp-attachments'
const TEMP_PROMPT_FILENAME_PREFIX = 'prompt-'
const TEMP_PROMPT_FILENAME_EXTENSION = '.md'
const TEMP_PROMPT_MIME_TYPE = 'text/markdown'
const TEMP_TEXT_ATTACHMENT_WRITE_CHUNK_BYTES = 32 * BYTES_PER_KIBIBYTE
const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const RTF_MIME_TYPE = 'application/rtf'
const ODT_MIME_TYPE = 'application/vnd.oasis.opendocument.text'
const TEMP_PROMPT_FILENAME_PATTERN = /^prompt-\d+\.md$/

const prepareArgsSchema = Schema.Struct({
  projectPath: Schema.String.pipe(Schema.minLength(1)),
  paths: Schema.Array(Schema.String).pipe(Schema.maxItems(MAX_ATTACHMENTS)),
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
  return choose(ext)
    .case('.pdf', () => 'application/pdf')
    .case('.png', () => 'image/png')
    .case('.jpg', () => 'image/jpeg')
    .case('.jpeg', () => 'image/jpeg')
    .case('.webp', () => 'image/webp')
    .case('.gif', () => 'image/gif')
    .case('.bmp', () => 'image/bmp')
    .case('.svg', () => 'image/svg+xml')
    .case('.md', () => 'text/markdown')
    .case('.json', () => 'application/json')
    .case('.yaml', () => 'application/yaml')
    .case('.yml', () => 'application/yaml')
    .case('.xml', () => 'application/xml')
    .case('.csv', () => 'text/csv')
    .case('.log', () => 'text/plain')
    .case('.docx', () => DOCX_MIME_TYPE)
    .case('.rtf', () => RTF_MIME_TYPE)
    .case('.odt', () => ODT_MIME_TYPE)
    .case('.ts', () => 'text/plain')
    .case('.tsx', () => 'text/plain')
    .case('.js', () => 'text/plain')
    .case('.jsx', () => 'text/plain')
    .case('.mjs', () => 'text/plain')
    .case('.cjs', () => 'text/plain')
    .case('.py', () => 'text/plain')
    .case('.java', () => 'text/plain')
    .case('.go', () => 'text/plain')
    .case('.rs', () => 'text/plain')
    .case('.swift', () => 'text/plain')
    .case('.kt', () => 'text/plain')
    .case('.css', () => 'text/plain')
    .case('.scss', () => 'text/plain')
    .case('.sass', () => 'text/plain')
    .case('.less', () => 'text/plain')
    .case('.html', () => 'text/plain')
    .case('.htm', () => 'text/plain')
    .case('.txt', () => 'text/plain')
    .catchAll(() => null)
}

function normalizeText(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length <= MAX_EXTRACTED_TEXT_CHARS) return trimmed
  return `${trimmed.slice(0, MAX_EXTRACTED_TEXT_CHARS)}\n...[truncated]`
}

async function requestExternalAttachmentAccess(
  projectRootPath: string,
  attachmentPath: string,
): Promise<boolean> {
  const result = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Allow once', 'Deny'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: 'Attachment outside project',
    message: 'This file is outside the active project folder.',
    detail: [
      `Project: ${projectRootPath}`,
      `Attachment: ${attachmentPath}`,
      '',
      'Allow this file once?',
    ].join('\n'),
  })
  return result.response === 0
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

    return choose(entity)
      .case('amp', () => '&')
      .case('lt', () => '<')
      .case('gt', () => '>')
      .case('quot', () => '"')
      .case('apos', () => "'")
      .catchAll(() => '')
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
  if (stats.size > MAX_ATTACHMENT_SIZE_BYTES) {
    throw new Error(
      `Attachment exceeds ${String(MAX_ATTACHMENT_SIZE_BYTES / (BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE))} MB: ${path.basename(filePath)}`,
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

  const extractedText = await choose(kind)
    .case('pdf', () =>
      withExtractionFallback(attachmentName, 'pdf', () => extractTextFromPdf(buffer)),
    )
    .case('image', () =>
      withExtractionFallback(attachmentName, 'image-ocr', () => extractTextFromImage(buffer)),
    )
    .catchAll(() =>
      choose(mimeType)
        .case(DOCX_MIME_TYPE, () =>
          withExtractionFallback(attachmentName, 'docx', () => extractTextFromDocx(buffer)),
        )
        .case(ODT_MIME_TYPE, () =>
          withExtractionFallback(attachmentName, 'odt', () => extractTextFromOdt(buffer)),
        )
        .case(RTF_MIME_TYPE, () => Promise.resolve(extractTextFromRtf(buffer.toString('utf8'))))
        .catchAll(() => Promise.resolve(normalizeText(buffer.toString('utf8')))),
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

async function hydrateAttachmentSource(
  attachment: PreparedAttachment,
): Promise<HydratedAttachment> {
  if (attachment.kind !== 'image' && attachment.kind !== 'pdf') {
    return { ...attachment, source: null }
  }

  const stats = await fs.stat(attachment.path)
  if (!stats.isFile()) {
    throw new Error(`Attachment is no longer a file: ${attachment.name}`)
  }
  if (stats.size > MAX_ATTACHMENT_SIZE_BYTES) {
    throw new Error(
      `Attachment exceeds ${String(MAX_ATTACHMENT_SIZE_BYTES / (BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE))} MB: ${attachment.name}`,
    )
  }

  const buffer = await fs.readFile(attachment.path)
  return {
    ...attachment,
    source: {
      type: 'data',
      value: buffer.toString('base64'),
      mimeType: attachment.mimeType,
    },
  }
}

export async function hydrateAttachmentSources(
  attachments: readonly PreparedAttachment[],
): Promise<HydratedAttachment[]> {
  const hydrated: HydratedAttachment[] = []
  for (const attachment of attachments) {
    hydrated.push(await hydrateAttachmentSource(attachment))
  }
  return hydrated
}

export function registerAttachmentHandlers(): void {
  void cleanupTempAttachments().catch((error: unknown) => {
    logger.warn('Temp prompt attachment cleanup failed during startup', describeUnknownError(error))
  })

  safeHandle('attachments:prepare', async (_event, rawProjectPath: unknown, rawPaths: unknown) => {
    const { projectPath, paths } = decodeUnknownOrThrow(prepareArgsSchema, {
      projectPath: rawProjectPath,
      paths: rawPaths,
    })

    if (!path.isAbsolute(projectPath)) {
      throw new Error('Project path must be absolute.')
    }

    const normalized = paths
      .map((entry) => (path.isAbsolute(entry) ? entry : path.resolve(projectPath, entry)))
      .map((entry) => path.normalize(entry))

    const uniquePaths = [...new Set(normalized)]
    if (uniquePaths.length === 0) return []
    if (uniquePaths.length > MAX_ATTACHMENTS) {
      throw new Error(
        `A maximum of ${String(MAX_ATTACHMENTS)} attachments is supported per message.`,
      )
    }

    const projectRoot = await fs.realpath(projectPath)
    const approvedPaths: string[] = []
    for (const filePath of uniquePaths) {
      const resolvedPath = await fs.realpath(filePath)
      if (!isPathInside(projectRoot, resolvedPath)) {
        const approved = await requestExternalAttachmentAccess(projectRoot, resolvedPath)
        if (!approved) {
          throw new Error(
            `Attachment access denied for file outside project root: ${path.basename(resolvedPath)}`,
          )
        }
      }
      approvedPaths.push(resolvedPath)
    }

    const stats = await Promise.all(approvedPaths.map((filePath) => fs.stat(filePath)))
    const totalSize = stats.reduce((sum, stat) => sum + stat.size, 0)
    if (totalSize > MAX_TOTAL_SIZE_BYTES) {
      throw new Error(
        `Total attachment size exceeds ${String(MAX_TOTAL_SIZE_BYTES / (BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE))} MB.`,
      )
    }

    const prepared: PreparedAttachment[] = []
    for (const filePath of approvedPaths) {
      prepared.push(await prepareAttachment(filePath))
    }
    return prepared
  })

  safeHandle(
    'attachments:prepare-from-text',
    async (_event, rawText: unknown, rawOperationId: unknown) => {
      const { text, operationId } = decodeUnknownOrThrow(prepareFromTextArgsSchema, {
        text: rawText,
        operationId: rawOperationId,
      })
      const tempAttachmentsDir = await ensureTempAttachmentsDirectory()
      const fileName = buildTempPromptFilename(Date.now())
      const filePath = path.join(tempAttachmentsDir, fileName)

      await writePromptTextFileWithProgress(filePath, text, operationId)
      const stats = await fs.stat(filePath)
      if (!stats.isFile()) {
        throw new Error(`Temporary prompt attachment is not a file: ${fileName}`)
      }

      return {
        id: randomUUID(),
        kind: 'text',
        origin: 'auto-paste-text',
        name: fileName,
        path: filePath,
        mimeType: TEMP_PROMPT_MIME_TYPE,
        sizeBytes: stats.size,
        extractedText: text,
      }
    },
  )
}
