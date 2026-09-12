import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { match } from '@diegogbrisa/ts-match'
import { ATTACHMENT, BYTES_PER_KIBIBYTE } from '@shared/constants/resource-limits'
import type { PreparedAttachment } from '@shared/types/agent'
import { forgetPreparedAttachment, rememberPreparedAttachment } from '../utils/attachment-registry'
import { ensureTempAttachmentsDirectory } from './attachment-temp-files'
import {
  DOCX_MIME_TYPE,
  extractAttachmentText,
  ODT_MIME_TYPE,
  RTF_MIME_TYPE,
} from './attachment-text-extraction'

const PRIVATE_ATTACHMENT_FILE_MODE = 0o600
const MAX_DISCARDABLE_SESSION_RESOURCE_ATTACHMENTS = 256
const discardableSessionResourceAttachmentIds = new Set<string>()

function rememberDiscardableSessionResourceAttachment(id: string) {
  discardableSessionResourceAttachmentIds.add(id)
  while (
    discardableSessionResourceAttachmentIds.size > MAX_DISCARDABLE_SESSION_RESOURCE_ATTACHMENTS
  ) {
    const oldestId = discardableSessionResourceAttachmentIds.values().next().value
    if (typeof oldestId !== 'string') break
    discardableSessionResourceAttachmentIds.delete(oldestId)
  }
}

function contentSha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

function resolveAttachmentKind(mimeType: string) {
  if (mimeType === 'application/pdf') return 'pdf'
  if (mimeType.startsWith('image/')) return 'image'
  return 'text'
}

function guessMimeType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase()
  return match(ext)
    .with('.pdf', () => 'application/pdf')
    .with('.png', () => 'image/png')
    .with('.jpg', () => 'image/jpeg')
    .with('.jpeg', () => 'image/jpeg')
    .with('.webp', () => 'image/webp')
    .with('.gif', () => 'image/gif')
    .with('.bmp', () => 'image/bmp')
    .with('.svg', () => 'image/svg+xml')
    .with('.md', () => 'text/markdown')
    .with('.json', () => 'application/json')
    .with('.yaml', () => 'application/yaml')
    .with('.yml', () => 'application/yaml')
    .with('.xml', () => 'application/xml')
    .with('.csv', () => 'text/csv')
    .with('.log', () => 'text/plain')
    .with('.docx', () => DOCX_MIME_TYPE)
    .with('.rtf', () => RTF_MIME_TYPE)
    .with('.odt', () => ODT_MIME_TYPE)
    .with('.ts', () => 'text/plain')
    .with('.tsx', () => 'text/plain')
    .with('.js', () => 'text/plain')
    .with('.jsx', () => 'text/plain')
    .with('.mjs', () => 'text/plain')
    .with('.cjs', () => 'text/plain')
    .with('.py', () => 'text/plain')
    .with('.java', () => 'text/plain')
    .with('.go', () => 'text/plain')
    .with('.rs', () => 'text/plain')
    .with('.swift', () => 'text/plain')
    .with('.kt', () => 'text/plain')
    .with('.css', () => 'text/plain')
    .with('.scss', () => 'text/plain')
    .with('.sass', () => 'text/plain')
    .with('.less', () => 'text/plain')
    .with('.html', () => 'text/plain')
    .with('.htm', () => 'text/plain')
    .with('.txt', () => 'text/plain')
    .otherwise(() => null)
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
  const extractedText = await extractAttachmentText({ kind, mimeType, buffer, attachmentName })

  return {
    id: randomUUID(),
    kind,
    origin: 'user-file',
    name: attachmentName,
    path: filePath,
    mimeType,
    sizeBytes: stats.size,
    contentSha256: contentSha256(buffer),
    extractedText,
  }
}

export async function prepareRegisteredAttachment(filePath: string): Promise<PreparedAttachment> {
  const attachment = await prepareAttachment(filePath)
  await rememberPreparedAttachment(attachment, filePath)
  return attachment
}

function imageAttachmentExtension(mimeType: string) {
  return match(mimeType)
    .with('image/png', () => '.png')
    .with('image/jpeg', () => '.jpg')
    .with('image/webp', () => '.webp')
    .with('image/gif', () => '.gif')
    .otherwise(() => null)
}

function compatibleImageAttachmentName(fileName: string, mimeType: string, extension: string) {
  const candidate = path.basename(fileName)
  if (guessMimeType(candidate) === mimeType) return candidate
  const candidateExtension = path.extname(candidate)
  const stem = candidate.slice(0, candidate.length - candidateExtension.length).trim()
  return `${stem || 'image'}${extension}`
}

export async function prepareRegisteredImageAttachmentFromBytes(input: {
  readonly bytes: Uint8Array
  readonly fileName: string
  readonly mimeType: string
}): Promise<PreparedAttachment> {
  if (input.bytes.byteLength > ATTACHMENT.MAX_SIZE_BYTES) {
    throw new Error(
      `Attachment exceeds ${String(ATTACHMENT.MAX_SIZE_BYTES / (BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE))} MB: ${path.basename(input.fileName)}`,
    )
  }

  const mimeType = input.mimeType.split(';')[0]?.trim().toLowerCase() ?? ''
  const extension = imageAttachmentExtension(mimeType)
  if (!extension) throw new Error(`Unsupported Session image type: ${input.mimeType}`)
  const attachmentName = compatibleImageAttachmentName(input.fileName, mimeType, extension)
  const buffer = Buffer.from(input.bytes)
  const kind = 'image'
  const extractedText = await extractAttachmentText({ kind, mimeType, buffer, attachmentName })
  const tempAttachmentsDir = await ensureTempAttachmentsDirectory()
  const filePath = path.join(tempAttachmentsDir, `resource-${randomUUID()}${extension}`)
  await fs.writeFile(filePath, buffer, { flag: 'wx', mode: PRIVATE_ATTACHMENT_FILE_MODE })

  const attachment: PreparedAttachment = {
    id: randomUUID(),
    kind,
    origin: 'user-file',
    name: attachmentName,
    path: filePath,
    mimeType,
    sizeBytes: buffer.byteLength,
    contentSha256: contentSha256(buffer),
    extractedText,
  }
  try {
    await rememberPreparedAttachment(attachment, filePath)
    rememberDiscardableSessionResourceAttachment(attachment.id)
    return attachment
  } catch (cause) {
    await fs.rm(filePath, { force: true }).catch(() => {})
    throw cause
  }
}

export async function discardRegisteredImageAttachment(
  attachment: PreparedAttachment,
): Promise<void> {
  if (!discardableSessionResourceAttachmentIds.has(attachment.id)) {
    throw new Error('Only an undelivered Session resource attachment can be discarded.')
  }
  const forgotten = await forgetPreparedAttachment(attachment)
  if (!forgotten) {
    discardableSessionResourceAttachmentIds.delete(attachment.id)
    return
  }
  discardableSessionResourceAttachmentIds.delete(attachment.id)
  await fs.rm(attachment.path, { force: true })
}

export { contentSha256 }
