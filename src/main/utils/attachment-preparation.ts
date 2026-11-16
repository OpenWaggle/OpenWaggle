import { createHash, randomUUID } from 'node:crypto'
import type { FileHandle } from 'node:fs/promises'
import fs from 'node:fs/promises'
import path from 'node:path'
import { match } from '@diegogbrisa/ts-match'
import { ATTACHMENT, BYTES_PER_KIBIBYTE } from '@shared/constants/resource-limits'
import type { AttachmentOrigin, PreparedAttachment } from '@shared/types/agent'
import {
  DOCX_MIME_TYPE,
  extractAttachmentText,
  ODT_MIME_TYPE,
  RTF_MIME_TYPE,
} from './attachment-text-extraction'
import {
  browserAttachmentMetadataJson,
  parseBrowserAttachmentMetadata,
} from './browser-attachment-metadata'
import { assertCanonicalDirectoryRoots } from './canonical-directory-roots'
import { convertHeicToAttachmentImage, isHeicImageMimeType } from './heic-image-conversion'
import { isPathInsideDirectory } from './project-path-validation'
import { writeTempAttachment } from './attachment-temp-directory'

export interface AttachmentPreparationEntry {
  readonly path: string
  readonly origin?: AttachmentOrigin
  readonly browserPreview?: PreparedAttachment['browserPreview']
  readonly browserAnnotationText?: string
}

/** Internal snapshot persisted by the Session Host; never exposed to renderer clients. */
export interface PreparedAttachmentSnapshot extends PreparedAttachment {
  readonly immutableSourceBase64: string
}

/** Remove Host-only snapshot bytes before a prepared attachment crosses a process boundary. */
export function toPublicPreparedAttachment(attachment: PreparedAttachment) {
  return {
    id: attachment.id,
    kind: attachment.kind,
    ...(attachment.origin ? { origin: attachment.origin } : {}),
    name: attachment.name,
    path: attachment.path,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    ...(attachment.contentSha256 ? { contentSha256: attachment.contentSha256 } : {}),
    extractedText: attachment.extractedText,
    ...(attachment.browserPreview ? { browserPreview: { ...attachment.browserPreview } } : {}),
  }
}

const ATTACHMENT_READ_CHUNK_BYTES = 64 * BYTES_PER_KIBIBYTE
const filesystemConstants = process.getBuiltinModule('node:fs').constants
const OPEN_READ_NO_FOLLOW_NONBLOCKING =
  filesystemConstants.O_RDONLY |
  (filesystemConstants.O_NOFOLLOW ?? 0) |
  (filesystemConstants.O_NONBLOCK ?? 0)

function sameFile(
  left: { readonly dev: number | bigint; readonly ino: number | bigint },
  right: { readonly dev: number | bigint; readonly ino: number | bigint },
) {
  return left.dev === right.dev && left.ino === right.ino
}

function attachmentLimitBytes(kind: PreparedAttachment['kind']) {
  return kind === 'image' ? ATTACHMENT.MAX_IMAGE_SIZE_BYTES : ATTACHMENT.MAX_SIZE_BYTES
}

function attachmentSizeLimitError(filePath: string, maxBytes: number) {
  return new Error(
    `Attachment exceeds ${String(maxBytes / (BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE))} MB: ${path.basename(filePath)}`,
  )
}

/** Chunked, so the memory held is the file read, not `maxBytes` per attachment (ADR 0068). */
async function readBoundedAttachment(handle: FileHandle, filePath: string, maxBytes: number) {
  const chunks: Buffer[] = []
  const chunk = Buffer.allocUnsafe(ATTACHMENT_READ_CHUNK_BYTES)
  let offset = 0
  let readBytes = 1
  while (readBytes > 0) {
    readBytes = (await handle.read(chunk, 0, chunk.byteLength, offset)).bytesRead
    offset += readBytes
    if (offset > maxBytes) throw attachmentSizeLimitError(filePath, maxBytes)
    chunks.push(Buffer.from(chunk.subarray(0, readBytes)))
  }
  return Buffer.concat(chunks, offset)
}

function resolveAttachmentKind(mimeType: string) {
  if (mimeType === 'application/pdf') return 'pdf' as const
  if (mimeType.startsWith('image/')) return 'image' as const
  return 'text' as const
}

function guessMimeType(filePath: string) {
  return match(path.extname(filePath).toLowerCase())
    .with('.pdf', () => 'application/pdf')
    .with('.png', () => 'image/png')
    .with('.jpg', '.jpeg', () => 'image/jpeg')
    .with('.webp', () => 'image/webp')
    .with('.gif', () => 'image/gif')
    .with('.heic', '.heif', () => 'image/heic')
    .with('.bmp', () => 'image/bmp')
    .with('.svg', () => 'image/svg+xml')
    .with('.md', () => 'text/markdown')
    .with('.json', () => 'application/json')
    .with('.yaml', '.yml', () => 'application/yaml')
    .with('.xml', () => 'application/xml')
    .with('.csv', () => 'text/csv')
    .with('.docx', () => DOCX_MIME_TYPE)
    .with('.rtf', () => RTF_MIME_TYPE)
    .with('.odt', () => ODT_MIME_TYPE)
    .with(
      '.log',
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
    )
    .otherwise(() => null)
}

interface AttachmentSnapshot {
  readonly buffer: Buffer
  readonly kind: PreparedAttachment['kind']
  readonly mimeType: string
  readonly name: string
  readonly origin: AttachmentOrigin
  readonly path: string
  readonly browserPreview?: PreparedAttachment['browserPreview']
  readonly browserAnnotationText?: string
}

/** The attachment a HEIC file becomes, on the path the app wrote its own copy to. */
async function convertedHeicSnapshot(input: {
  readonly buffer: Buffer
  readonly origin: AttachmentOrigin
  readonly name: string
}) {
  const converted = await convertHeicToAttachmentImage({
    bytes: input.buffer,
    fileName: input.name,
  })
  return {
    buffer: converted.bytes,
    kind: 'image' as const,
    mimeType: converted.mimeType,
    name: converted.fileName,
    origin: input.origin,
    path: await writeTempAttachment(converted.bytes, '.jpg', 'attachment'),
  }
}

/** The kind, read limit and MIME type an authorized attachment path is read under. */
function attachmentReadPlan(canonicalPath: string, requestedPath: string) {
  const mimeType = guessMimeType(canonicalPath)
  if (!mimeType) {
    throw new Error(
      `Unsupported attachment type: ${path.basename(requestedPath)}. Supported: text files, images (PNG, JPEG, WebP, GIF, HEIC, HEIF), and PDFs.`,
    )
  }
  const kind = resolveAttachmentKind(mimeType)
  return { kind, maxBytes: attachmentLimitBytes(kind), mimeType }
}

async function readAttachmentSnapshot(
  filePath: string,
  origin: AttachmentOrigin,
  allowedRoots: readonly string[] | undefined,
  beforeRead?: (filePath: string) => Promise<void>,
) {
  if (allowedRoots && !allowedRoots.some((root) => isPathInsideDirectory(root, filePath))) {
    throw new Error('Attachment path is outside the caller-authorized workspace.')
  }
  let handle: FileHandle
  try {
    handle = await fs.open(filePath, OPEN_READ_NO_FOLLOW_NONBLOCKING)
  } catch (error) {
    if (allowedRoots && error instanceof Error && 'code' in error && error.code === 'ELOOP') {
      throw new Error('Attachment symbolic links are not accepted for scoped callers.', {
        cause: error,
      })
    }
    throw error
  }
  try {
    const stats = await handle.stat()
    if (!stats.isFile()) throw new Error(`Not a file: ${filePath}`)
    const canonicalPath = await fs.realpath(filePath)
    if (allowedRoots && !allowedRoots.some((root) => isPathInsideDirectory(root, canonicalPath))) {
      throw new Error('Attachment path is outside the caller-authorized workspace.')
    }
    const linkedStats = await fs.stat(canonicalPath)
    if (!sameFile(stats, linkedStats)) {
      throw new Error('Attachment source changed while it was being authorized.')
    }
    const { kind, maxBytes, mimeType } = attachmentReadPlan(canonicalPath, filePath)
    if (stats.size > maxBytes) throw attachmentSizeLimitError(filePath, maxBytes)
    await beforeRead?.(canonicalPath)
    const buffer = await readBoundedAttachment(handle, canonicalPath, maxBytes)
    const name = path.basename(canonicalPath)

    // Nothing downstream has to know HEIC existed: Pi's decoder cannot read it (ADR 0068).
    if (isHeicImageMimeType(mimeType)) {
      return await convertedHeicSnapshot({ buffer, origin, name })
    }

    return {
      buffer,
      kind,
      mimeType,
      name,
      origin,
      path: canonicalPath,
    }
  } finally {
    await handle.close()
  }
}

async function extractAttachmentSnapshot(snapshot: AttachmentSnapshot) {
  return {
    id: randomUUID(),
    kind: snapshot.kind,
    origin: snapshot.origin,
    ...(snapshot.browserPreview ? { browserPreview: snapshot.browserPreview } : {}),
    name: snapshot.name,
    path: snapshot.path,
    mimeType: snapshot.mimeType,
    sizeBytes: snapshot.buffer.byteLength,
    contentSha256: createHash('sha256').update(snapshot.buffer).digest('hex'),
    immutableSourceBase64: snapshot.buffer.toString('base64'),
    extractedText:
      snapshot.browserAnnotationText ??
      (await extractAttachmentText({
        kind: snapshot.kind,
        mimeType: snapshot.mimeType,
        buffer: snapshot.buffer,
        attachmentName: snapshot.name,
      })),
  }
}

export async function prepareAttachmentFiles(input: {
  readonly baseDirectory: string
  readonly entries: readonly AttachmentPreparationEntry[]
  readonly allowedRoots?: readonly string[]
  readonly beforeRead?: (filePath: string) => Promise<void>
}) {
  if (input.entries.length > ATTACHMENT.MAX_COUNT) {
    throw new Error(`A maximum of ${String(ATTACHMENT.MAX_COUNT)} attachments is supported.`)
  }
  const normalized = input.entries.map((entry) => {
    const metadata = browserAttachmentMetadataJson(entry.browserPreview)
    if (
      (metadata !== null || entry.browserAnnotationText !== undefined) &&
      entry.origin !== 'browser-preview'
    ) {
      throw new Error('Browser annotation context requires a browser-preview attachment.')
    }
    if (
      entry.browserAnnotationText !== undefined &&
      entry.browserAnnotationText.length > ATTACHMENT.MAX_EXTRACTED_TEXT_CHARS
    ) {
      throw new Error('Browser annotation context exceeds the attachment text limit.')
    }
    return {
      path: path.normalize(
        path.isAbsolute(entry.path) ? entry.path : path.resolve(input.baseDirectory, entry.path),
      ),
      origin: entry.origin ?? 'user-file',
      ...(metadata === null ? {} : { browserPreview: parseBrowserAttachmentMetadata(metadata) }),
      ...(entry.browserAnnotationText === undefined
        ? {}
        : { browserAnnotationText: entry.browserAnnotationText }),
    }
  })
  const unique = [...new Map(normalized.map((entry) => [JSON.stringify(entry), entry])).values()]
  const roots = input.allowedRoots
    ? await assertCanonicalDirectoryRoots(input.allowedRoots, 'Profile attachment root')
    : undefined
  const snapshots = await Promise.all(
    unique.map(async ({ path: entryPath, origin, ...browserContext }) => ({
      ...(await readAttachmentSnapshot(entryPath, origin, roots, input.beforeRead)),
      ...browserContext,
    })),
  )
  // Images are bounded one by one instead: Pi reduces each one for the model, so their sizes do
  // not add up to anything the app has to refuse (ADR 0068).
  const totalSize = snapshots.reduce(
    (sum, snapshot) => (snapshot.kind === 'image' ? sum : sum + snapshot.buffer.byteLength),
    0,
  )
  if (totalSize > ATTACHMENT.MAX_TOTAL_SIZE_BYTES) {
    throw new Error(
      `Total attachment size exceeds ${String(ATTACHMENT.MAX_TOTAL_SIZE_BYTES / (BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE))} MB.`,
    )
  }
  return await Promise.all(snapshots.map(extractAttachmentSnapshot))
}
