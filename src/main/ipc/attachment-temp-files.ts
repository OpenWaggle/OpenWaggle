import fs from 'node:fs/promises'
import path from 'node:path'
import { PERCENT_BASE } from '@shared/constants/math'
import { ATTACHMENT, BYTES_PER_KIBIBYTE } from '@shared/constants/resource-limits'
import { TIME_UNIT } from '@shared/constants/time'
import { app } from 'electron'
import { createLogger } from '../logger'
import { broadcastToWindows } from '../utils/broadcast'

const logger = createLogger('ipc/attachments')
const MILLISECONDS_PER_HOUR =
  TIME_UNIT.SECONDS_PER_MINUTE * TIME_UNIT.SECONDS_PER_MINUTE * TIME_UNIT.MILLISECONDS_PER_SECOND
const TEMP_ATTACHMENT_RETENTION_MS = TIME_UNIT.HOURS_PER_DAY * MILLISECONDS_PER_HOUR
const TEMP_ATTACHMENTS_DIRECTORY_NAME = 'temp-attachments'
const TEMP_PROMPT_FILENAME_PREFIX = 'prompt-'
const TEMP_PROMPT_FILENAME_EXTENSION = '.md'
export const TEMP_PROMPT_MIME_TYPE = 'text/markdown'
const TEMP_TEXT_ATTACHMENT_WRITE_CHUNK_BYTES = 32 * BYTES_PER_KIBIBYTE
export const TEXT_ATTACHMENT_MAX_SIZE_MB =
  ATTACHMENT.MAX_SIZE_BYTES / (BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE)
const TEMP_PROMPT_FILENAME_PATTERN = /^prompt-\d+\.md$/

function describeUnknownError(error: unknown) {
  return error instanceof Error ? { message: error.message } : { message: String(error) }
}

export function buildTempPromptFilename(timestamp: number) {
  return `${TEMP_PROMPT_FILENAME_PREFIX}${String(timestamp)}${TEMP_PROMPT_FILENAME_EXTENSION}`
}

export async function ensureTempAttachmentsDirectory() {
  const tempAttachmentsDir = path.join(app.getPath('userData'), TEMP_ATTACHMENTS_DIRECTORY_NAME)
  await fs.mkdir(tempAttachmentsDir, { recursive: true })
  return tempAttachmentsDir
}
export async function cleanupTempAttachments() {
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
}) {
  broadcastToWindows('attachments:prepare-from-text-progress', payload)
}

function toProgressPercent(bytesWritten: number, totalBytes: number) {
  if (totalBytes <= 0) return PERCENT_BASE
  const percent = Math.round((bytesWritten / totalBytes) * PERCENT_BASE)
  return Math.max(0, Math.min(PERCENT_BASE, percent))
}

export async function writePromptTextFileWithProgress(
  filePath: string,
  text: string,
  operationId: string,
) {
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
