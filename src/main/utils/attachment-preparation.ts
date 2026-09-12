import { randomUUID } from 'node:crypto'
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
import { isPathInsideDirectory } from './project-path-validation'

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
export function toPublicPreparedAttachment(attachment: PreparedAttachment): PreparedAttachment {
  return {
    id: attachment.id,
    kind: attachment.kind,
    ...(attachment.origin ? { origin: attachment.origin } : {}),
    name: attachment.name,
    path: attachment.path,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    extractedText: attachment.extractedText,
    ...(attachment.browserPreview ? { browserPreview: { ...attachment.browserPreview } } : {}),
  }
}

const ATTACHMENT_LIMIT_SENTINEL_BYTES = 1
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

async function readBoundedAttachment(handle: FileHandle, filePath: string) {
  const buffer = Buffer.allocUnsafe(ATTACHMENT.MAX_SIZE_BYTES + ATTACHMENT_LIMIT_SENTINEL_BYTES)
  let offset = 0
  while (offset < buffer.byteLength) {
    const result = await handle.read(buffer, offset, buffer.byteLength - offset, offset)
    if (result.bytesRead === 0) break
    offset += result.bytesRead
  }
  if (offset > ATTACHMENT.MAX_SIZE_BYTES) {
    throw new Error(
      `Attachment exceeds ${String(ATTACHMENT.MAX_SIZE_BYTES / (BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE))} MB: ${path.basename(filePath)}`,
    )
  }
  return buffer.subarray(0, offset)
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

async function readAttachmentSnapshot(
  filePath: string,
  origin: AttachmentOrigin,
  allowedRoots: readonly string[] | undefined,
  beforeRead?: (filePath: string) => Promise<void>,
): Promise<AttachmentSnapshot> {
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
    if (stats.size > ATTACHMENT.MAX_SIZE_BYTES) {
      throw new Error(
        `Attachment exceeds ${String(ATTACHMENT.MAX_SIZE_BYTES / (BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE))} MB: ${path.basename(filePath)}`,
      )
    }
    const canonicalPath = await fs.realpath(filePath)
    if (allowedRoots && !allowedRoots.some((root) => isPathInsideDirectory(root, canonicalPath))) {
      throw new Error('Attachment path is outside the caller-authorized workspace.')
    }
    const linkedStats = await fs.stat(canonicalPath)
    if (!sameFile(stats, linkedStats)) {
      throw new Error('Attachment source changed while it was being authorized.')
    }
    const mimeType = guessMimeType(canonicalPath)
    if (!mimeType) {
      throw new Error(
        `Unsupported attachment type: ${path.basename(filePath)}. Supported: text files, images, PDFs.`,
      )
    }
    await beforeRead?.(canonicalPath)
    const buffer = await readBoundedAttachment(handle, canonicalPath)
    const kind = resolveAttachmentKind(mimeType)
    const name = path.basename(canonicalPath)
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

async function extractAttachmentSnapshot(
  snapshot: AttachmentSnapshot,
): Promise<PreparedAttachmentSnapshot> {
  return {
    id: randomUUID(),
    kind: snapshot.kind,
    origin: snapshot.origin,
    ...(snapshot.browserPreview ? { browserPreview: snapshot.browserPreview } : {}),
    name: snapshot.name,
    path: snapshot.path,
    mimeType: snapshot.mimeType,
    sizeBytes: snapshot.buffer.byteLength,
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
}): Promise<PreparedAttachmentSnapshot[]> {
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
    unique.map(async (entry) => ({
      ...(await readAttachmentSnapshot(entry.path, entry.origin, roots, input.beforeRead)),
      browserPreview: entry.browserPreview,
      browserAnnotationText: entry.browserAnnotationText,
    })),
  )
  const totalSize = snapshots.reduce((sum, snapshot) => sum + snapshot.buffer.byteLength, 0)
  if (totalSize > ATTACHMENT.MAX_TOTAL_SIZE_BYTES) {
    throw new Error(
      `Total attachment size exceeds ${String(ATTACHMENT.MAX_TOTAL_SIZE_BYTES / (BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE))} MB.`,
    )
  }
  return await Promise.all(snapshots.map(extractAttachmentSnapshot))
}
