import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { match } from '@diegogbrisa/ts-match'
import { ATTACHMENT, BYTES_PER_KIBIBYTE } from '@shared/constants/resource-limits'
import type { PreparedAttachment } from '@shared/types/agent'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import { forgetPreparedAttachment, rememberPreparedAttachment } from '../utils/attachment-registry'
import {
  isNamedTempAttachmentDirectory,
  writeNamedTempAttachment,
} from '../utils/attachment-temp-directory'
import {
  DOCX_MIME_TYPE,
  extractAttachmentText,
  ODT_MIME_TYPE,
  RTF_MIME_TYPE,
} from '../utils/attachment-text-extraction'
import { dispatchHostAttachmentPreparation } from './host-attachment-preparation'

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
    .with('.heic', () => 'image/heic')
    .with('.heif', () => 'image/heif')
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

async function prepareAttachment(filePath: string) {
  const stats = await fs.stat(filePath)
  if (!stats.isFile()) {
    throw new Error(`Not a file: ${filePath}`)
  }
  const mimeType = guessMimeType(filePath)
  if (!mimeType) {
    throw new Error(
      `Unsupported attachment type: ${path.basename(filePath)}. Supported: text files, images (PNG, JPEG, WebP, GIF, HEIC, HEIF), and PDFs.`,
    )
  }
  const kind = resolveAttachmentKind(mimeType)
  const maxBytes = kind === 'image' ? ATTACHMENT.MAX_IMAGE_SIZE_BYTES : ATTACHMENT.MAX_SIZE_BYTES
  if (stats.size > maxBytes) {
    throw new Error(
      `Attachment exceeds ${String(maxBytes / (BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE))} MB: ${path.basename(filePath)}`,
    )
  }
  const buffer = await fs.readFile(filePath)
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
  } satisfies PreparedAttachment
}

export async function prepareRegisteredAttachment(filePath: string) {
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
    .with('image/heic', () => '.heic')
    .with('image/heif', () => '.heif')
    .otherwise(() => null)
}

/** Leaves room under the 255 bytes file systems accept for the copy's directory to stay short. */
const MAX_IMAGE_COPY_NAME_BYTES = 200
/** What Windows refuses in a file name, and control characters everywhere. */
const NON_PORTABLE_NAME_CHARACTERS = /[<>:"/\\|?*\p{Cc}]/gu
const WINDOWS_RESERVED_STEM = /^(?:con|prn|aux|nul|com\d|lpt\d)$/iu

/**
 * The stem the copy is written under. The name becomes a real file the Host names the attachment
 * after, so a resource title or a pasted name must be one every platform can write.
 */
function portableImageStem(stem: string, extension: string) {
  const budget = MAX_IMAGE_COPY_NAME_BYTES - Buffer.byteLength(extension)
  let bounded = ''
  for (const character of stem.replaceAll(NON_PORTABLE_NAME_CHARACTERS, '_').trim()) {
    if (Buffer.byteLength(bounded + character) > budget) break
    bounded += character
  }
  // Windows drops a trailing dot or space, and a reserved stem names a device, not a file.
  const trimmed = bounded.replace(/[. ]+$/u, '')
  if (!trimmed) return 'image'
  return WINDOWS_RESERVED_STEM.test(trimmed) ? `_${trimmed}` : trimmed
}

function compatibleImageAttachmentName(fileName: string, mimeType: string, extension: string) {
  const candidate = path.basename(fileName)
  const candidateExtension = path.extname(candidate)
  const stem = candidate.slice(0, candidate.length - candidateExtension.length)
  const nameExtension = guessMimeType(candidate) === mimeType ? candidateExtension : extension
  return `${portableImageStem(stem, nameExtension)}${nameExtension}`
}

/**
 * The Host prepares the copy as the file it is. Its attachment store accepts no
 * `session-resource` origin, and the origin means nothing to a send: the window keeps it, below,
 * as the mark that it owns the copy and deletes it when the chip is let go of.
 */
async function prepareCopyThroughHost(copyPath: string) {
  const exit = await Effect.runPromiseExit(
    dispatchHostAttachmentPreparation(path.dirname(copyPath), [
      { path: copyPath, origin: 'user-file' },
    ]),
  )
  // Effect's own failure wrapper would hide the Host's reason from the person who pasted.
  if (Exit.isFailure(exit)) throw Cause.squash(exit.cause)
  const [attachment] = exit.value
  if (exit.value.length !== 1 || attachment?.kind !== 'image') {
    throw new Error(`Session Host did not prepare the image: ${path.basename(copyPath)}`)
  }
  return attachment
}

/**
 * An image that exists only as bytes: a pasted screenshot, or a Session resource added to the
 * draft. Its copy is written under the name the person sees and the Session Host prepares it from
 * there, as it prepares a picked file: the Host binds a message only to attachments it prepared
 * (#465), and it reads the image's text and decodes a HEIC as it does for any file (ADR 0068).
 */
export async function prepareRegisteredImageAttachmentFromBytes(input: {
  readonly bytes: Uint8Array
  readonly fileName: string
  readonly mimeType: string
}) {
  if (input.bytes.byteLength > ATTACHMENT.MAX_IMAGE_SIZE_BYTES) {
    throw new Error(
      `Attachment exceeds ${String(ATTACHMENT.MAX_IMAGE_SIZE_BYTES / (BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE))} MB: ${path.basename(input.fileName)}`,
    )
  }

  // A blob the browser could not type (a pasted HEIC, for one) is typed by its name instead.
  const mimeType =
    input.mimeType.split(';')[0]?.trim().toLowerCase() || (guessMimeType(input.fileName) ?? '')
  const extension = imageAttachmentExtension(mimeType)
  if (!extension) {
    throw new Error(`Unsupported Session image type: ${mimeType || path.basename(input.fileName)}`)
  }
  const attachmentName = compatibleImageAttachmentName(input.fileName, mimeType, extension)
  const copyPath = await writeNamedTempAttachment(
    Buffer.from(input.bytes),
    attachmentName,
    'resource',
  )
  const copyDirectory = path.dirname(copyPath)
  // A HEIC becomes the JPEG the Host decoded into a file of its own, outside the copy directory.
  let hostOwnedPath: string | null = null
  try {
    const prepared = await prepareCopyThroughHost(copyPath)
    if (path.basename(path.dirname(prepared.path)) !== path.basename(copyDirectory)) {
      hostOwnedPath = prepared.path
      await fs.rm(copyDirectory, { recursive: true, force: true })
    }
    const attachment: PreparedAttachment = { ...prepared, origin: 'session-resource' }
    await rememberPreparedAttachment(attachment, attachment.path)
    return attachment
  } catch (cause) {
    await fs.rm(copyDirectory, { recursive: true, force: true }).catch(() => {})
    if (hostOwnedPath) await fs.rm(hostOwnedPath, { force: true }).catch(() => {})
    throw cause
  }
}

export async function discardRegisteredImageAttachment(attachment: PreparedAttachment) {
  if (attachment.origin !== 'session-resource') {
    throw new Error('Only an undelivered Session resource attachment can be discarded.')
  }
  const forgotten = await forgetPreparedAttachment(attachment)
  if (!forgotten) return
  const directory = path.dirname(attachment.path)
  if (isNamedTempAttachmentDirectory(path.basename(directory))) {
    await fs.rm(directory, { recursive: true, force: true })
    return
  }
  await fs.rm(attachment.path, { force: true })
}

export { contentSha256 }
