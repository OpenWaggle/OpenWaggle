export const MAX_CAPTURED_IMAGE_BYTES = 25 * 1024 * 1024
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex')
const JPEG_SIGNATURE = Buffer.from('ffd8ff', 'hex')
const GIF_SIGNATURE_LENGTH = 6
const RIFF_SIGNATURE_LENGTH = 4
const WEBP_SIGNATURE_START = 8
const WEBP_SIGNATURE_END = 12
const SVG_INSPECTION_BYTES = 4 * 1024

export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/svg+xml',
  'image/webp',
])

export interface ValidatedSessionResourceImage {
  readonly bytes: Buffer
  readonly mimeType: string
}

function normalizeImageMimeType(mimeType: string) {
  return mimeType.split(';')[0]?.trim().toLowerCase() ?? ''
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
  if (mimeType === 'image/svg+xml') {
    return /<svg(?:\s|>)/iu.test(
      Buffer.from(bytes.subarray(0, SVG_INSPECTION_BYTES)).toString('utf8'),
    )
  }
  return false
}

export function validatedImageBuffer(
  bytes: Uint8Array,
  mimeType: string,
): ValidatedSessionResourceImage | null {
  const normalizedMimeType = normalizeImageMimeType(mimeType)
  if (!ALLOWED_IMAGE_MIME_TYPES.has(normalizedMimeType)) return null
  return bytes.byteLength > 0 &&
    bytes.byteLength <= MAX_CAPTURED_IMAGE_BYTES &&
    hasImageSignature(bytes, normalizedMimeType)
    ? { bytes: Buffer.from(bytes), mimeType: normalizedMimeType }
    : null
}

export function validatedImageBytes(data: string, mimeType: string) {
  const normalizedMimeType = normalizeImageMimeType(mimeType)
  if (!ALLOWED_IMAGE_MIME_TYPES.has(normalizedMimeType)) return null
  const decodedByteLength = Buffer.byteLength(data, 'base64')
  if (decodedByteLength <= 0 || decodedByteLength > MAX_CAPTURED_IMAGE_BYTES) return null
  return validatedImageBuffer(Buffer.from(data, 'base64'), normalizedMimeType)
}

export const MAX_REMOTE_IMAGE_BYTES = MAX_CAPTURED_IMAGE_BYTES
