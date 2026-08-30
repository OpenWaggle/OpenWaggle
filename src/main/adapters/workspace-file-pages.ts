import fs from 'node:fs/promises'
import path from 'node:path'
import { WORKSPACE_EDITOR_PERFORMANCE } from '@shared/constants/workspace-editor-performance'
import type { WorkspaceFilePage, WorkspaceTextEncoding } from '@shared/types/workspace-files'
import {
  detectWorkspaceTextEncodingMarker,
  hasBinaryBytes,
  LANGUAGE_BY_EXTENSION,
  workspaceFilePreviewKind,
} from './workspace-file-content'
import { resolveExistingWorkspaceFile } from './workspace-file-paths'

const FILE_KIND_SAMPLE_BYTES = 8 * 1024
const TEXT_ENCODING_MARKER_BYTES = 3
const TEXT_PAGE_BOUNDARY_BYTES = 4
const UTF16_CODE_UNIT_BYTES = 2
const MAX_UTF8_TRAILING_BYTES = 3
const UTF8_LEADING_BITS_MASK = 0xc0
const UTF8_CONTINUATION_PREFIX = 0x80

function isUtf8ContinuationByte(value: number | undefined) {
  return value !== undefined && (value & UTF8_LEADING_BITS_MASK) === UTF8_CONTINUATION_PREFIX
}

function pageDecoderEncoding(encoding: WorkspaceTextEncoding) {
  return encoding === 'utf-8-bom' ? 'utf-8' : encoding
}

function decodeCompletePage(buffer: Uint8Array, encoding: WorkspaceTextEncoding) {
  const decoderEncoding = pageDecoderEncoding(encoding)
  const maximumTrim =
    encoding === 'utf-8' || encoding === 'utf-8-bom'
      ? MAX_UTF8_TRAILING_BYTES
      : UTF16_CODE_UNIT_BYTES
  for (let trim = 0; trim <= Math.min(maximumTrim, buffer.length); trim += 1) {
    const end = buffer.length - trim
    if ((encoding === 'utf-16le' || encoding === 'utf-16be') && end % UTF16_CODE_UNIT_BYTES !== 0) {
      continue
    }
    try {
      return {
        content: new TextDecoder(decoderEncoding, { fatal: true }).decode(buffer.subarray(0, end)),
        bytesDecoded: end,
      }
    } catch {
      // A page can end in the middle of one encoded character. Only trim that suffix.
    }
  }
  throw new Error('This source page contains invalid text for its declared encoding.')
}

export async function readWorkspaceFilePage(input: {
  readonly projectPath: string
  readonly path: string
  readonly offset: number
  readonly limit: number
}): Promise<WorkspaceFilePage> {
  const resolved = await resolveExistingWorkspaceFile(input)
  const requestedOffset = Math.min(input.offset, resolved.stats.size)
  const handle = await fs.open(resolved.realFilePath, 'r')
  const markerBuffer = Buffer.alloc(Math.min(TEXT_ENCODING_MARKER_BYTES, resolved.stats.size))
  const sample = Buffer.alloc(Math.min(FILE_KIND_SAMPLE_BYTES, resolved.stats.size))
  try {
    await handle.read(markerBuffer, 0, markerBuffer.length, 0)
    await handle.read(sample, 0, sample.length, 0)
    const marker = detectWorkspaceTextEncodingMarker(markerBuffer)
    const extension = path.extname(resolved.relativePath).toLowerCase()
    const sampledKind = workspaceFilePreviewKind(extension, sample)
    if (
      sampledKind === 'image' ||
      sampledKind === 'pdf' ||
      (hasBinaryBytes(sample) && marker.encoding === 'utf-8')
    ) {
      throw new Error('Binary files cannot be opened in the paged source view.')
    }

    let decodeOffset = Math.max(requestedOffset, marker.byteLength)
    if (marker.encoding === 'utf-16le' || marker.encoding === 'utf-16be') {
      const relativeOffset = decodeOffset - marker.byteLength
      decodeOffset =
        marker.byteLength +
        Math.ceil(relativeOffset / UTF16_CODE_UNIT_BYTES) * UTF16_CODE_UNIT_BYTES
    }
    const readLimit = Math.min(
      Math.max(input.limit, TEXT_PAGE_BOUNDARY_BYTES),
      WORKSPACE_EDITOR_PERFORMANCE.SOURCE_PAGE_MAX_BYTES,
      resolved.stats.size - decodeOffset,
    )
    const buffer = Buffer.alloc(Math.max(0, readLimit))
    const read = await handle.read(buffer, 0, buffer.length, decodeOffset)
    let pageBuffer = buffer.subarray(0, read.bytesRead)
    if (marker.encoding === 'utf-8' || marker.encoding === 'utf-8-bom') {
      let leadingContinuationBytes = 0
      while (isUtf8ContinuationByte(pageBuffer[leadingContinuationBytes])) {
        leadingContinuationBytes += 1
      }
      decodeOffset += leadingContinuationBytes
      pageBuffer = pageBuffer.subarray(leadingContinuationBytes)
    }
    const decoded = decodeCompletePage(pageBuffer, marker.encoding)
    const endOffset = decodeOffset + decoded.bytesDecoded
    return {
      path: resolved.relativePath,
      size: resolved.stats.size,
      offset: requestedOffset < marker.byteLength ? 0 : decodeOffset,
      endOffset,
      nextOffset: endOffset < resolved.stats.size ? endOffset : null,
      content: decoded.content,
      encoding: marker.encoding,
      ...(LANGUAGE_BY_EXTENSION[extension] ? { language: LANGUAGE_BY_EXTENSION[extension] } : {}),
    }
  } finally {
    await handle.close()
  }
}
