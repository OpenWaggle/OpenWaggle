import os from 'node:os'
import path from 'node:path'
import * as Effect from 'effect/Effect'
import { MAX_CAPTURED_IMAGE_BYTES } from '../domain/session-resource-image'
import { SessionResourceImageValidator } from '../ports/session-resource-image-validator'
import { SessionResourceStore } from '../ports/session-resource-store'
import {
  advanceGeneratedImageCaptureBudget,
  beginGeneratedImageCaptureAttempt,
  GENERATED_IMAGE_CAPTURE_LIMITS,
  type GeneratedImageCaptureBudget,
  prepareGeneratedImageForCapture,
} from './session-resource-capture-image-budget'
import type { CapturedGeneratedImage, CapturedImage } from './session-resource-extraction'

const AGENT_IMAGE_TEMP_DIRECTORIES = ['electron-qa-evidence', 'openwaggle-evidence'] as const

export function localImageCaptureRoots(workingPath: string | null) {
  const temporaryParents = [os.tmpdir(), process.platform === 'win32' ? null : '/tmp'].filter(
    (root): root is string => root !== null,
  )
  return [
    ...(workingPath ? [workingPath] : []),
    ...temporaryParents.flatMap((root) =>
      AGENT_IMAGE_TEMP_DIRECTORIES.map((directory) => path.join(root, directory)),
    ),
  ]
}

export function generatedImageInput(image: CapturedImage): CapturedGeneratedImage {
  return 'data' in image ? image : { data: '', mimeType: image.mimeType, title: image.title }
}

export function capturedImageSourcePath(image: CapturedImage) {
  return 'filePath' in image ? image.filePath : undefined
}

export function prepareCapturedImageForCapture(
  current: GeneratedImageCaptureBudget,
  image: CapturedImage,
  allowedRoots: readonly string[],
) {
  if ('data' in image) return Effect.succeed(prepareGeneratedImageForCapture(current, image))
  const attemptedBudget = beginGeneratedImageCaptureAttempt(current)
  if (!attemptedBudget) return Effect.succeed(null)
  const remainingBytes = Math.min(
    MAX_CAPTURED_IMAGE_BYTES,
    GENERATED_IMAGE_CAPTURE_LIMITS.maxBytes - current.bytes,
  )
  return Effect.gen(function* () {
    const store = yield* SessionResourceStore
    const source = yield* store
      .readSource({ sourcePath: image.filePath, allowedRoots, maxSizeBytes: remainingBytes })
      .pipe(Effect.option)
    if (source._tag === 'None') {
      return { budget: attemptedBudget, byteBudgetExceeded: false, image: null }
    }
    const validator = yield* SessionResourceImageValidator
    const validated = yield* validator.validate(source.value, image.mimeType)
    if (!validated) {
      return { budget: attemptedBudget, byteBudgetExceeded: false, image: null }
    }
    const budget = advanceGeneratedImageCaptureBudget(attemptedBudget, validated.bytes.byteLength)
    return budget ? { budget, byteBudgetExceeded: false, image: validated } : null
  })
}
