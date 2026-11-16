import { PI_PROMPT_IMAGE_DEFAULTS } from '@shared/constants/prompt-image'
import { loadSharp } from '../adapters/sharp-module'
import { lazyModule } from './lazy-module'

const BASE64_INPUT_BYTES = 3
const BASE64_OUTPUT_BYTES = 4
const RGBA_CHANNELS = 4
/** Each step the encoder shrinks by when the payload still does not fit. */
const SCALE_STEP = 0.8
/** How far the encode may shrink: a 20000px image can still fit, and 16 steps reach this floor. */
const MIN_SCALE = 0.05
/** The steps from full size down to the floor, so the encode loop cannot run on. */
const MAX_ENCODE_ATTEMPTS = 16

const HEIC_MIME_TYPES = new Set([
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
])

/** Pi measures its inline image budget in base64 characters, so this does too. */
export function base64ByteLength(byteLength: number) {
  return Math.ceil(byteLength / BASE64_INPUT_BYTES) * BASE64_OUTPUT_BYTES
}

export function isHeicImageMimeType(mimeType: string) {
  return HEIC_MIME_TYPES.has(mimeType.split(';')[0]?.trim().toLowerCase() ?? '')
}

export interface DecodedImage {
  readonly data: Uint8ClampedArray
  readonly width: number
  readonly height: number
}

/** libheif reads the format Pi's own decoder cannot (ADR 0068), with the container transform applied. */
const loadHeicDecode = lazyModule(async () => {
  const module = await import('heic-decode')
  return module.default
})

async function decodeHeic(bytes: Uint8Array) {
  const decode = await loadHeicDecode()
  const image = await decode({ buffer: bytes })
  if (image.width <= 0 || image.height <= 0) {
    throw new Error('The image has no pixels to attach.')
  }
  return image
}

function jpegFileName(fileName: string) {
  const dot = fileName.lastIndexOf('.')
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName
  return `${stem || 'image'}.jpg`
}

/**
 * Encodes the pixels once, inside Pi's own defaults, so Pi passes the image through instead of
 * resizing it a second time. Smaller dimensions are tried until the payload fits.
 */
export async function encodePromptImage(image: DecodedImage) {
  const sharp = await loadSharp()
  const source = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength)
  const longEdge = Math.max(image.width, image.height)
  let scale = Math.max(MIN_SCALE, Math.min(1, PI_PROMPT_IMAGE_DEFAULTS.MAX_DIMENSION / longEdge))

  // Each step shrinks by the same factor, so the loop is bounded by the steps left to the floor.
  for (let attempt = 0; attempt < MAX_ENCODE_ATTEMPTS; attempt += 1) {
    const width = Math.max(1, Math.round(image.width * scale))
    const height = Math.max(1, Math.round(image.height * scale))
    const encoded = await sharp(source, {
      raw: { width: image.width, height: image.height, channels: RGBA_CHANNELS },
    })
      .resize({ width, height, fit: 'fill' })
      .jpeg({ quality: PI_PROMPT_IMAGE_DEFAULTS.JPEG_QUALITY })
      .toBuffer()
    if (base64ByteLength(encoded.byteLength) < PI_PROMPT_IMAGE_DEFAULTS.MAX_BASE64_BYTES) {
      return encoded
    }
    if (scale <= MIN_SCALE) break
    scale = Math.max(MIN_SCALE, scale * SCALE_STEP)
  }
  throw new Error('The image could not be made to fit the prompt image budget.')
}

/**
 * The attachment a HEIC file becomes: one JPEG encode, named after the file it came from, so Pi
 * receives an image it can carry and no other path has to know HEIC existed (ADR 0068).
 */
export async function convertHeicToAttachmentImage(input: {
  readonly bytes: Uint8Array
  readonly fileName: string
}) {
  const image = await decodeHeic(input.bytes)
  const bytes = await encodePromptImage(image)
  return { bytes, fileName: jpegFileName(input.fileName), mimeType: 'image/jpeg' as const }
}
