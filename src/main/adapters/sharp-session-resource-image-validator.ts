import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import sharp from 'sharp'
import {
  type ValidatedSessionResourceImage,
  validatedImageBuffer,
} from '../domain/session-resource-image'
import {
  SessionResourceImageValidator,
  type SessionResourceImageValidatorShape,
} from '../ports/session-resource-image-validator'

export const SESSION_RESOURCE_IMAGE_DECODE_LIMITS = {
  maxFrames: 128,
  maxPixelsAcrossFrames: 40_000_000,
} as const

function safePixelCount(width: number, height: number, pages: number) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    !Number.isSafeInteger(pages) ||
    width <= 0 ||
    height <= 0 ||
    pages <= 0 ||
    pages > SESSION_RESOURCE_IMAGE_DECODE_LIMITS.maxFrames
  ) {
    return null
  }
  const pixels = width * height * pages
  return Number.isSafeInteger(pixels) &&
    pixels <= SESSION_RESOURCE_IMAGE_DECODE_LIMITS.maxPixelsAcrossFrames
    ? pixels
    : null
}

export async function decodeSessionResourceImage(
  bytes: Uint8Array,
  mimeType: string,
): Promise<ValidatedSessionResourceImage | null> {
  const structurallyValid = validatedImageBuffer(bytes, mimeType)
  if (!structurallyValid) return null
  try {
    const metadata = await sharp(structurallyValid.bytes, {
      animated: true,
      failOn: 'error',
      limitInputPixels: SESSION_RESOURCE_IMAGE_DECODE_LIMITS.maxPixelsAcrossFrames,
    }).metadata()
    const pages = metadata.pages ?? 1
    const pageHeight = metadata.pageHeight ?? metadata.height
    if (
      metadata.width === undefined ||
      pageHeight === undefined ||
      safePixelCount(metadata.width, pageHeight, pages) === null
    ) {
      return null
    }
    // Decoding all pixels catches truncated/corrupt payloads that only have a plausible header.
    await sharp(structurallyValid.bytes, {
      animated: true,
      failOn: 'error',
      limitInputPixels: SESSION_RESOURCE_IMAGE_DECODE_LIMITS.maxPixelsAcrossFrames,
    })
      .raw()
      .toBuffer()
    return structurallyValid
  } catch {
    return null
  }
}

export function createSharpSessionResourceImageValidator(): SessionResourceImageValidatorShape {
  return {
    validate: (bytes, mimeType) =>
      Effect.promise(() => decodeSessionResourceImage(bytes, mimeType)),
  }
}

export const SharpSessionResourceImageValidatorLive = Layer.succeed(
  SessionResourceImageValidator,
  SessionResourceImageValidator.of(createSharpSessionResourceImageValidator()),
)
