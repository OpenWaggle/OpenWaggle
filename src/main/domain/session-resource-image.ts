export const MAX_CAPTURED_IMAGE_BYTES = 25 * 1024 * 1024
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex')
const JPEG_SIGNATURE = Buffer.from('ffd8ff', 'hex')
const GIF_SIGNATURE_LENGTH = 6
const RIFF_SIGNATURE_LENGTH = 4
const WEBP_SIGNATURE_START = 8
const WEBP_SIGNATURE_END = 12
const MAX_IMAGE_PIXELS = 40_000_000
const BYTE_SHIFT = 8
const JPEG_INITIAL_OFFSET = 2
const JPEG_SCAN_GUARD_BYTES = 8
const JPEG_MARKER_PREFIX = 0xff
const JPEG_START_OF_IMAGE = 0xd8
const JPEG_END_OF_IMAGE = 0xd9
const JPEG_SEGMENT_MIN_LENGTH = 2
const JPEG_HEIGHT_HIGH_OFFSET = 3
const JPEG_HEIGHT_LOW_OFFSET = 4
const JPEG_WIDTH_HIGH_OFFSET = 5
const JPEG_WIDTH_LOW_OFFSET = 6
const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])
const PNG_MIN_HEADER_LENGTH = 24
const PNG_CHUNK_TYPE_START = 12
const PNG_CHUNK_TYPE_END = 16
const PNG_WIDTH_OFFSET = 16
const PNG_HEIGHT_OFFSET = 20
const GIF_MIN_HEADER_LENGTH = 10
const GIF_WIDTH_OFFSET = 6
const GIF_HEIGHT_OFFSET = 8
const WEBP_MIN_HEADER_LENGTH = 30
const WEBP_FORMAT_START = 12
const WEBP_FORMAT_END = 16
const WEBP_EXTENDED_WIDTH_OFFSET = 24
const WEBP_EXTENDED_HEIGHT_OFFSET = 27
const WEBP_EXTENDED_DIMENSION_BYTES = 3
const WEBP_LOSSY_SIGNATURE_START = 23
const WEBP_LOSSY_SIGNATURE_END = 26
const WEBP_LOSSY_WIDTH_OFFSET = 26
const WEBP_LOSSY_HEIGHT_OFFSET = 28
const WEBP_LOSSLESS_SIGNATURE_OFFSET = 20
const WEBP_LOSSLESS_SIGNATURE = 0x2f
const WEBP_LOSSLESS_BITS_OFFSET = 21
const WEBP_DIMENSION_MASK = 0x3fff
const WEBP_HEIGHT_SHIFT = 14
const DIMENSION_BASE = 1

export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
])

export interface ValidatedSessionResourceImage {
  readonly bytes: Buffer
  readonly mimeType: string
}

function normalizeImageMimeType(mimeType: string) {
  return mimeType.split(';')[0]?.trim().toLowerCase() ?? ''
}

/** Returns the decoded size without allocating the decoded image buffer. */
export function imageBase64DecodedByteLength(data: string, mimeType: string) {
  const normalizedMimeType = normalizeImageMimeType(mimeType)
  if (!ALLOWED_IMAGE_MIME_TYPES.has(normalizedMimeType)) return null
  const decodedByteLength = Buffer.byteLength(data, 'base64')
  return decodedByteLength > 0 && decodedByteLength <= MAX_CAPTURED_IMAGE_BYTES
    ? decodedByteLength
    : null
}

function startsWithSignature(bytes: Uint8Array, signature: Uint8Array) {
  return Buffer.from(bytes.subarray(0, signature.byteLength)).equals(signature)
}

function hasImageSignature(bytes: Uint8Array, mimeType: string) {
  if (mimeType === 'image/png') {
    return startsWithSignature(bytes, PNG_SIGNATURE)
  }
  if (mimeType === 'image/jpeg') return startsWithSignature(bytes, JPEG_SIGNATURE)
  if (mimeType === 'image/gif') {
    const header = Buffer.from(bytes.subarray(0, GIF_SIGNATURE_LENGTH)).toString('ascii')
    return header === 'GIF87a' || header === 'GIF89a'
  }
  if (mimeType === 'image/webp') {
    return (
      Buffer.from(bytes.subarray(0, RIFF_SIGNATURE_LENGTH)).toString('ascii') === 'RIFF' &&
      Buffer.from(bytes.subarray(WEBP_SIGNATURE_START, WEBP_SIGNATURE_END)).toString('ascii') ===
        'WEBP'
    )
  }
  return false
}

function validDimensions(width: number, height: number) {
  return width > 0 && height > 0 && width * height <= MAX_IMAGE_PIXELS
}

function jpegDimensions(bytes: Uint8Array) {
  let offset = JPEG_INITIAL_OFFSET
  while (offset + JPEG_SCAN_GUARD_BYTES < bytes.byteLength) {
    if (bytes[offset] !== JPEG_MARKER_PREFIX) return null
    const marker = bytes[offset + DIMENSION_BASE] ?? 0
    offset += JPEG_INITIAL_OFFSET
    if (marker === JPEG_START_OF_IMAGE || marker === JPEG_END_OF_IMAGE) continue
    const length = ((bytes[offset] ?? 0) << BYTE_SHIFT) | (bytes[offset + DIMENSION_BASE] ?? 0)
    if (length < JPEG_SEGMENT_MIN_LENGTH || offset + length > bytes.byteLength) return null
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      return {
        height:
          ((bytes[offset + JPEG_HEIGHT_HIGH_OFFSET] ?? 0) << BYTE_SHIFT) |
          (bytes[offset + JPEG_HEIGHT_LOW_OFFSET] ?? 0),
        width:
          ((bytes[offset + JPEG_WIDTH_HIGH_OFFSET] ?? 0) << BYTE_SHIFT) |
          (bytes[offset + JPEG_WIDTH_LOW_OFFSET] ?? 0),
      }
    }
    offset += length
  }
  return null
}

function imageDimensions(bytes: Uint8Array, mimeType: string) {
  const view = Buffer.from(bytes)
  if (
    mimeType === 'image/png' &&
    bytes.byteLength >= PNG_MIN_HEADER_LENGTH &&
    view.toString('ascii', PNG_CHUNK_TYPE_START, PNG_CHUNK_TYPE_END) === 'IHDR'
  ) {
    return {
      width: view.readUInt32BE(PNG_WIDTH_OFFSET),
      height: view.readUInt32BE(PNG_HEIGHT_OFFSET),
    }
  }
  if (mimeType === 'image/gif' && bytes.byteLength >= GIF_MIN_HEADER_LENGTH) {
    return {
      width: view.readUInt16LE(GIF_WIDTH_OFFSET),
      height: view.readUInt16LE(GIF_HEIGHT_OFFSET),
    }
  }
  if (mimeType === 'image/jpeg') return jpegDimensions(bytes)
  if (mimeType === 'image/webp' && bytes.byteLength >= WEBP_MIN_HEADER_LENGTH) {
    const format = view.toString('ascii', WEBP_FORMAT_START, WEBP_FORMAT_END)
    if (format === 'VP8X')
      return {
        width:
          DIMENSION_BASE +
          view.readUIntLE(WEBP_EXTENDED_WIDTH_OFFSET, WEBP_EXTENDED_DIMENSION_BYTES),
        height:
          DIMENSION_BASE +
          view.readUIntLE(WEBP_EXTENDED_HEIGHT_OFFSET, WEBP_EXTENDED_DIMENSION_BYTES),
      }
    if (
      format === 'VP8 ' &&
      view.toString('hex', WEBP_LOSSY_SIGNATURE_START, WEBP_LOSSY_SIGNATURE_END) === '9d012a'
    )
      return {
        width: view.readUInt16LE(WEBP_LOSSY_WIDTH_OFFSET) & WEBP_DIMENSION_MASK,
        height: view.readUInt16LE(WEBP_LOSSY_HEIGHT_OFFSET) & WEBP_DIMENSION_MASK,
      }
    if (format === 'VP8L' && view[WEBP_LOSSLESS_SIGNATURE_OFFSET] === WEBP_LOSSLESS_SIGNATURE) {
      const bits = view.readUInt32LE(WEBP_LOSSLESS_BITS_OFFSET)
      return {
        width: DIMENSION_BASE + (bits & WEBP_DIMENSION_MASK),
        height: DIMENSION_BASE + ((bits >>> WEBP_HEIGHT_SHIFT) & WEBP_DIMENSION_MASK),
      }
    }
  }
  return null
}

export function validatedImageBuffer(
  bytes: Uint8Array,
  mimeType: string,
): ValidatedSessionResourceImage | null {
  const normalizedMimeType = normalizeImageMimeType(mimeType)
  if (!ALLOWED_IMAGE_MIME_TYPES.has(normalizedMimeType)) return null
  return bytes.byteLength > 0 &&
    bytes.byteLength <= MAX_CAPTURED_IMAGE_BYTES &&
    hasImageSignature(bytes, normalizedMimeType) &&
    (() => {
      const dimensions = imageDimensions(bytes, normalizedMimeType)
      return dimensions !== null && validDimensions(dimensions.width, dimensions.height)
    })()
    ? { bytes: Buffer.from(bytes), mimeType: normalizedMimeType }
    : null
}

export function validatedImageBytes(data: string, mimeType: string) {
  if (imageBase64DecodedByteLength(data, mimeType) === null) return null
  return validatedImageBuffer(Buffer.from(data, 'base64'), mimeType)
}

export const MAX_REMOTE_IMAGE_BYTES = MAX_CAPTURED_IMAGE_BYTES
