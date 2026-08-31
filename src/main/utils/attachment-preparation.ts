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
import { assertCanonicalDirectoryRoots } from './canonical-directory-roots'
import { isPathInsideDirectory } from './project-path-validation'

export interface AttachmentPreparationEntry {
  readonly path: string
  readonly origin?: AttachmentOrigin
}

/** Internal snapshot persisted by the Session Host; never exposed to renderer clients. */
export interface PreparedAttachmentSnapshot extends PreparedAttachment {
  readonly immutableSourceBase64: string
}

const ATTACHMENT_LIMIT_SENTINEL_BYTES = 1
const filesystemConstants = process.getBuiltinModule('node:fs').constants
const OPEN_READ_NO_FOLLOW = filesystemConstants.O_RDONLY | (filesystemConstants.O_NOFOLLOW ?? 0)

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

async function prepareAttachment(
  filePath: string,
  origin: AttachmentOrigin,
  allowedRoots: readonly string[] | undefined,
  beforeRead?: (filePath: string) => Promise<void>,
): Promise<PreparedAttachmentSnapshot> {
  let handle: FileHandle
  try {
    handle = await fs.open(filePath, OPEN_READ_NO_FOLLOW)
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
      id: randomUUID(),
      kind,
      origin,
      name,
      path: canonicalPath,
      mimeType,
      sizeBytes: buffer.byteLength,
      immutableSourceBase64: buffer.toString('base64'),
      extractedText: await extractAttachmentText({
        kind,
        mimeType,
        buffer,
        attachmentName: name,
      }),
    }
  } finally {
    await handle.close()
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
  const normalized = input.entries.map((entry) => ({
    path: path.normalize(
      path.isAbsolute(entry.path) ? entry.path : path.resolve(input.baseDirectory, entry.path),
    ),
    origin: entry.origin ?? 'user-file',
  }))
  const unique = [
    ...new Map(normalized.map((entry) => [`${entry.origin}:${entry.path}`, entry])).values(),
  ]
  const roots = input.allowedRoots
    ? await assertCanonicalDirectoryRoots(input.allowedRoots, 'Profile attachment root')
    : undefined
  const prepared = await Promise.all(
    unique.map((entry) => prepareAttachment(entry.path, entry.origin, roots, input.beforeRead)),
  )
  const totalSize = prepared.reduce((sum, attachment) => sum + attachment.sizeBytes, 0)
  if (totalSize > ATTACHMENT.MAX_TOTAL_SIZE_BYTES) {
    throw new Error(
      `Total attachment size exceeds ${String(ATTACHMENT.MAX_TOTAL_SIZE_BYTES / (BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE))} MB.`,
    )
  }
  return prepared
}
