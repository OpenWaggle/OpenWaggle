import type { Buffer } from 'node:buffer'
import {
  DIB_FORMAT,
  GIF_FORMAT,
  ICO_FORMAT,
  JPEG_FORMAT,
  MAX_FAVICON_SOURCE_PIXELS,
  PNG_FORMAT,
  PNG_SIGNATURE,
  WEBP_FORMAT,
} from './browser-preview-favicon-format-constants'
import {
  type BrowserPreviewImageDimensions,
  safeBrowserPreviewImageDimensions,
} from './browser-preview-favicon-image'

export type { BrowserPreviewImageDimensions } from './browser-preview-favicon-image'
export { safeBrowserPreviewImageDimensions } from './browser-preview-favicon-image'

function pngDimensions(buffer: Buffer): BrowserPreviewImageDimensions | null {
  if (
    buffer.byteLength < PNG_FORMAT.MIN_BYTES ||
    !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    return null
  }
  return {
    width: buffer.readUInt32BE(PNG_FORMAT.WIDTH_OFFSET),
    height: buffer.readUInt32BE(PNG_FORMAT.HEIGHT_OFFSET),
  }
}

function skipGifBlocks(buffer: Buffer, offset: number): number | null {
  let cursor = offset
  while (cursor < buffer.byteLength) {
    const length = buffer[cursor]
    if (length === undefined) return null
    cursor += 1
    if (length === 0) return cursor
    if (cursor + length > buffer.byteLength) return null
    cursor += length
  }
  return null
}

function gifColorTableBytes(packed: number) {
  if ((packed & GIF_FORMAT.COLOR_TABLE_FLAG) === 0) return 0
  return (
    GIF_FORMAT.COLOR_BYTES * GIF_FORMAT.POWER_BASE ** ((packed & GIF_FORMAT.COLOR_TABLE_MASK) + 1)
  )
}

function readGifFrame(buffer: Buffer, cursor: number) {
  if (cursor + GIF_FORMAT.FRAME_BYTES > buffer.byteLength) return null
  const width = buffer.readUInt16LE(cursor + GIF_FORMAT.FRAME_WIDTH_OFFSET)
  const height = buffer.readUInt16LE(cursor + GIF_FORMAT.FRAME_HEIGHT_OFFSET)
  let dataOffset = cursor + GIF_FORMAT.FRAME_BYTES
  dataOffset += gifColorTableBytes(buffer[cursor + GIF_FORMAT.FRAME_PACKED_OFFSET] ?? 0)
  const codeSize = buffer[dataOffset]
  if (
    width === 0 ||
    height === 0 ||
    codeSize === undefined ||
    codeSize < GIF_FORMAT.MIN_CODE_SIZE ||
    codeSize > GIF_FORMAT.MAX_CODE_SIZE
  ) {
    return null
  }
  const next = skipGifBlocks(buffer, dataOffset + 1)
  if (next === null) return null
  return {
    left: buffer.readUInt16LE(cursor + GIF_FORMAT.LEFT_OFFSET),
    top: buffer.readUInt16LE(cursor + GIF_FORMAT.TOP_OFFSET),
    width,
    height,
    next,
  }
}

function gifDimensions(buffer: Buffer): BrowserPreviewImageDimensions | null {
  if (
    buffer.byteLength < GIF_FORMAT.HEADER_BYTES ||
    !/^GIF8[79]a$/u.test(buffer.subarray(0, GIF_FORMAT.SIGNATURE_BYTES).toString('ascii'))
  ) {
    return null
  }
  let dimensions = {
    width: buffer.readUInt16LE(GIF_FORMAT.WIDTH_OFFSET),
    height: buffer.readUInt16LE(GIF_FORMAT.HEIGHT_OFFSET),
  }
  if (!safeBrowserPreviewImageDimensions(dimensions)) return null
  let cursor = GIF_FORMAT.HEADER_BYTES + gifColorTableBytes(buffer[GIF_FORMAT.PACKED_OFFSET] ?? 0)
  let framePixels = 0
  let frames = 0
  while (cursor < buffer.byteLength) {
    const marker = buffer[cursor]
    if (marker === GIF_FORMAT.TRAILER) return frames > 0 ? dimensions : null
    if (marker === GIF_FORMAT.IMAGE) {
      const frame = readGifFrame(buffer, cursor)
      if (frame === null) return null
      framePixels += frame.width * frame.height
      dimensions = {
        width: Math.max(dimensions.width, frame.left + frame.width),
        height: Math.max(dimensions.height, frame.top + frame.height),
      }
      if (
        framePixels > MAX_FAVICON_SOURCE_PIXELS ||
        !safeBrowserPreviewImageDimensions(dimensions)
      ) {
        return null
      }
      cursor = frame.next
      frames += 1
      continue
    }
    if (marker !== GIF_FORMAT.EXTENSION) return null
    const next = skipGifBlocks(buffer, cursor + GIF_FORMAT.MIN_CODE_SIZE)
    if (next === null) return null
    cursor = next
  }
  return null
}

function nextJpegMarker(buffer: Buffer, offset: number) {
  let cursor = offset
  while (cursor < buffer.byteLength) {
    if (buffer[cursor] !== JPEG_FORMAT.START_PREFIX) {
      cursor += 1
      continue
    }
    while (buffer[cursor] === JPEG_FORMAT.START_PREFIX) cursor += 1
    const marker = buffer[cursor]
    return marker === undefined ? null : { marker, next: cursor + 1 }
  }
  return null
}

function hasJpegHeader(buffer: Buffer) {
  return (
    buffer.byteLength >= JPEG_FORMAT.MIN_BYTES &&
    buffer[0] === JPEG_FORMAT.START_PREFIX &&
    buffer[1] === JPEG_FORMAT.START_IMAGE
  )
}

function endsJpegImage(marker: number) {
  return marker === JPEG_FORMAT.END_IMAGE || marker === JPEG_FORMAT.START_SCAN
}

function isStandaloneJpegMarker(marker: number) {
  return (
    marker === JPEG_FORMAT.TEMPORARY ||
    (marker >= JPEG_FORMAT.RESTART_MIN && marker <= JPEG_FORMAT.RESTART_MAX)
  )
}

function jpegFrameDimensions(buffer: Buffer, cursor: number, length: number) {
  if (length < JPEG_FORMAT.FRAME_MIN_LENGTH) return null
  return {
    width: buffer.readUInt16BE(cursor + JPEG_FORMAT.WIDTH_OFFSET),
    height: buffer.readUInt16BE(cursor + JPEG_FORMAT.HEIGHT_OFFSET),
  }
}

function jpegDimensions(buffer: Buffer): BrowserPreviewImageDimensions | null {
  if (!hasJpegHeader(buffer)) return null
  let cursor = JPEG_FORMAT.TEMPORARY + 1
  let dimensions: BrowserPreviewImageDimensions | null = null
  while (cursor < buffer.byteLength) {
    const found = nextJpegMarker(buffer, cursor)
    if (found === null) break
    cursor = found.next
    const { marker } = found
    if (endsJpegImage(marker)) break
    if (isStandaloneJpegMarker(marker)) continue
    if (cursor + 1 >= buffer.byteLength) return null
    const length = buffer.readUInt16BE(cursor)
    if (length < JPEG_FORMAT.TEMPORARY + 1 || cursor + length > buffer.byteLength) return null
    if (JPEG_FORMAT.FRAME_MARKERS.has(marker)) {
      if (dimensions !== null) return null
      dimensions = jpegFrameDimensions(buffer, cursor, length)
      if (dimensions === null) return null
    }
    cursor += length
  }
  return safeBrowserPreviewImageDimensions(dimensions) ? dimensions : null
}

function webpDimensions(buffer: Buffer): BrowserPreviewImageDimensions | null {
  if (
    buffer.byteLength < WEBP_FORMAT.MIN_BYTES ||
    buffer.subarray(0, WEBP_FORMAT.RIFF_END).toString('ascii') !== 'RIFF' ||
    buffer.subarray(WEBP_FORMAT.WEBP_START, WEBP_FORMAT.WEBP_END).toString('ascii') !== 'WEBP'
  ) {
    return null
  }
  const kind = buffer.subarray(WEBP_FORMAT.KIND_START, WEBP_FORMAT.KIND_END).toString('ascii')
  if (kind === 'VP8X') {
    return {
      width: 1 + buffer.readUIntLE(WEBP_FORMAT.VP8X_WIDTH_OFFSET, WEBP_FORMAT.UINT24_BYTES),
      height: 1 + buffer.readUIntLE(WEBP_FORMAT.VP8X_HEIGHT_OFFSET, WEBP_FORMAT.UINT24_BYTES),
    }
  }
  if (
    kind === 'VP8 ' &&
    buffer
      .subarray(WEBP_FORMAT.VP8_SIGNATURE_START, WEBP_FORMAT.VP8_SIGNATURE_END)
      .equals(WEBP_FORMAT.VP8_SIGNATURE)
  ) {
    return {
      width: buffer.readUInt16LE(WEBP_FORMAT.VP8_WIDTH_OFFSET) & WEBP_FORMAT.VP8_DIMENSION_MASK,
      height: buffer.readUInt16LE(WEBP_FORMAT.VP8_HEIGHT_OFFSET) & WEBP_FORMAT.VP8_DIMENSION_MASK,
    }
  }
  if (kind === 'VP8L' && buffer[WEBP_FORMAT.VP8L_SIGNATURE_OFFSET] === WEBP_FORMAT.VP8L_SIGNATURE) {
    const byteTwo = buffer[WEBP_FORMAT.VP8L_BYTE_TWO] ?? 0
    return {
      width:
        1 +
        (buffer[WEBP_FORMAT.VP8L_BYTE_ONE] ?? 0) +
        ((byteTwo & WEBP_FORMAT.VP8L_WIDTH_MASK) << WEBP_FORMAT.VP8L_WIDTH_SHIFT),
      height:
        1 +
        (byteTwo >> WEBP_FORMAT.VP8L_HEIGHT_LOW_SHIFT) +
        ((buffer[WEBP_FORMAT.VP8L_BYTE_THREE] ?? 0) << WEBP_FORMAT.VP8L_HEIGHT_MID_SHIFT) +
        (((buffer[WEBP_FORMAT.VP8L_BYTE_FOUR] ?? 0) & WEBP_FORMAT.VP8L_HEIGHT_MASK) <<
          WEBP_FORMAT.VP8L_HEIGHT_HIGH_SHIFT),
    }
  }
  return null
}

function dibDimensions(buffer: Buffer): BrowserPreviewImageDimensions | null {
  if (buffer.byteLength < DIB_FORMAT.CORE_HEADER_BYTES) return null
  const headerSize = buffer.readUInt32LE(0)
  if (headerSize === DIB_FORMAT.CORE_HEADER_BYTES) {
    return {
      width: buffer.readUInt16LE(DIB_FORMAT.WIDTH_OFFSET),
      height: buffer.readUInt16LE(DIB_FORMAT.CORE_HEIGHT_OFFSET),
    }
  }
  if (headerSize < DIB_FORMAT.INFO_HEADER_BYTES) return null
  return {
    width: Math.abs(buffer.readInt32LE(DIB_FORMAT.WIDTH_OFFSET)),
    height: Math.abs(buffer.readInt32LE(DIB_FORMAT.HEIGHT_OFFSET)),
  }
}

function icoEntryDimension(value: number | undefined) {
  return value === 0 ? ICO_FORMAT.FULL_DIMENSION : (value ?? 0)
}

function readIcoEntry(buffer: Buffer, count: number, index: number) {
  const offset = ICO_FORMAT.DIRECTORY_OFFSET + index * ICO_FORMAT.ENTRY_BYTES
  const byteLength = buffer.readUInt32LE(offset + ICO_FORMAT.BYTE_LENGTH_OFFSET)
  const imageOffset = buffer.readUInt32LE(offset + ICO_FORMAT.IMAGE_OFFSET_OFFSET)
  const directoryEnd = ICO_FORMAT.DIRECTORY_OFFSET + count * ICO_FORMAT.ENTRY_BYTES
  if (
    byteLength === 0 ||
    imageOffset < directoryEnd ||
    imageOffset > buffer.length ||
    byteLength > buffer.length - imageOffset
  ) {
    return null
  }
  const embedded = buffer.subarray(imageOffset, imageOffset + byteLength)
  if (!safeBrowserPreviewImageDimensions(pngDimensions(embedded) ?? dibDimensions(embedded))) {
    return null
  }
  return {
    width: icoEntryDimension(buffer[offset]),
    height: icoEntryDimension(buffer[offset + 1]),
  }
}

function icoDimensions(buffer: Buffer): BrowserPreviewImageDimensions | null {
  if (buffer.byteLength < ICO_FORMAT.MIN_BYTES || buffer.readUInt16LE(0) !== 0) return null
  const kind = buffer.readUInt16LE(ICO_FORMAT.KIND_OFFSET)
  const count = buffer.readUInt16LE(ICO_FORMAT.COUNT_OFFSET)
  const directoryEnd = ICO_FORMAT.DIRECTORY_OFFSET + count * ICO_FORMAT.ENTRY_BYTES
  if (
    (kind !== ICO_FORMAT.ICON_KIND && kind !== ICO_FORMAT.CURSOR_KIND) ||
    count === 0 ||
    count > ICO_FORMAT.MAX_ENTRIES ||
    directoryEnd > buffer.length
  ) {
    return null
  }
  let dimensions = { width: 0, height: 0 }
  for (let index = 0; index < count; index += 1) {
    const entry = readIcoEntry(buffer, count, index)
    if (entry === null) return null
    dimensions = {
      width: Math.max(dimensions.width, entry.width),
      height: Math.max(dimensions.height, entry.height),
    }
    if (!safeBrowserPreviewImageDimensions(dimensions)) return null
  }
  return dimensions
}

export function browserPreviewImageDimensions(
  buffer: Buffer,
): BrowserPreviewImageDimensions | null {
  const dimensions =
    pngDimensions(buffer) ??
    gifDimensions(buffer) ??
    jpegDimensions(buffer) ??
    webpDimensions(buffer) ??
    icoDimensions(buffer)
  return safeBrowserPreviewImageDimensions(dimensions) ? dimensions : null
}
