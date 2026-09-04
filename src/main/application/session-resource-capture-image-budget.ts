import {
  imageBase64DecodedByteLength,
  MAX_CAPTURED_IMAGE_BYTES,
  type ValidatedSessionResourceImage,
  validatedImageBytes,
} from '../domain/session-resource-image'

export const GENERATED_IMAGE_CAPTURE_LIMITS = {
  maxBytes: 100 * 1024 * 1024,
  maxCount: 32,
  maxAttempts: 32,
} as const

export interface GeneratedImageCaptureBudget {
  readonly bytes: number
  readonly count: number
  readonly attempts: number
}

interface GeneratedImageInput {
  readonly data: string
  readonly mimeType: string
}

type GeneratedImageValidator = (
  data: string,
  mimeType: string,
) => ValidatedSessionResourceImage | null

export function advanceGeneratedImageCaptureBudget(
  current: GeneratedImageCaptureBudget,
  byteLength: number,
): GeneratedImageCaptureBudget | null {
  if (
    !Number.isSafeInteger(byteLength) ||
    byteLength <= 0 ||
    byteLength > MAX_CAPTURED_IMAGE_BYTES ||
    current.count >= GENERATED_IMAGE_CAPTURE_LIMITS.maxCount ||
    current.bytes > GENERATED_IMAGE_CAPTURE_LIMITS.maxBytes - byteLength
  ) {
    return null
  }
  return {
    bytes: current.bytes + byteLength,
    count: current.count + 1,
    attempts: current.attempts,
  }
}

/**
 * Avoids allocating a decoded buffer when the byte budget cannot accept the image.
 * Every candidate charges the attempt budget; only validated images charge count and bytes.
 */
export function prepareGeneratedImageForCapture(
  current: GeneratedImageCaptureBudget,
  image: GeneratedImageInput,
  validate: GeneratedImageValidator = validatedImageBytes,
): {
  readonly budget: GeneratedImageCaptureBudget
  readonly byteBudgetExceeded: boolean
  readonly image: ValidatedSessionResourceImage | null
} | null {
  if (
    current.count >= GENERATED_IMAGE_CAPTURE_LIMITS.maxCount ||
    current.bytes >= GENERATED_IMAGE_CAPTURE_LIMITS.maxBytes ||
    current.attempts >= GENERATED_IMAGE_CAPTURE_LIMITS.maxAttempts
  ) {
    return null
  }
  const attemptedBudget = { ...current, attempts: current.attempts + 1 }
  const decodedByteLength = imageBase64DecodedByteLength(image.data, image.mimeType)
  if (
    decodedByteLength === null ||
    advanceGeneratedImageCaptureBudget(attemptedBudget, decodedByteLength) === null
  ) {
    return {
      budget: attemptedBudget,
      byteBudgetExceeded:
        decodedByteLength !== null &&
        current.bytes > GENERATED_IMAGE_CAPTURE_LIMITS.maxBytes - decodedByteLength,
      image: null,
    }
  }
  const validatedImage = validate(image.data, image.mimeType)
  if (!validatedImage) {
    return { budget: attemptedBudget, byteBudgetExceeded: false, image: null }
  }
  const budget = advanceGeneratedImageCaptureBudget(
    attemptedBudget,
    validatedImage.bytes.byteLength,
  )
  return budget ? { budget, byteBudgetExceeded: false, image: validatedImage } : null
}
