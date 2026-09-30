import os from 'node:os'
import path from 'node:path'
import * as Effect from 'effect/Effect'
import { MAX_CAPTURED_IMAGE_BYTES } from '../domain/session-resource-image'
import { SessionResourceImageValidator } from '../ports/session-resource-image-validator'
import { SessionResourceStore } from '../ports/session-resource-store'
import { sessionEvidenceRoot } from '../utils/session-evidence-directory'
import { sessionScratchDirectoryPath } from '../utils/session-scratch-directory'
import {
  advanceGeneratedImageCaptureBudget,
  beginGeneratedImageCaptureAttempt,
  GENERATED_IMAGE_CAPTURE_LIMITS,
  type GeneratedImageCaptureBudget,
} from './session-resource-capture-image-budget'
import type {
  CapturedGeneratedImage,
  CapturedImage,
  CapturedLocalImage,
} from './session-resource-extraction'

const AGENT_IMAGE_TEMP_DIRECTORIES = ['electron-qa-evidence', 'openwaggle-evidence'] as const

/**
 * Where an assistant's `file:` images may be captured from: the workspace, the dedicated agent
 * evidence directories in the shared temp directory, the Session's own scratch directory, and the
 * user's evidence directories. The agent's `TMPDIR` is that scratch directory, so
 * `$TMPDIR/electron-qa-evidence/...` lands there; it is private to the Session, so the whole
 * directory is allowed. `$OPENWAGGLE_EVIDENCE_DIR` survives archiving, so a Queen can embed the
 * screenshots of a Worker that cleanup archived.
 */
export function localImageCaptureRoots(workingPath: string | null, sessionId: string) {
  const temporaryParents = [os.tmpdir(), process.platform === 'win32' ? null : '/tmp'].filter(
    (root): root is string => root !== null,
  )
  return [
    ...(workingPath ? [workingPath] : []),
    sessionScratchDirectoryPath(sessionId),
    sessionEvidenceRoot(),
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

export function prepareLocalImageForCapture(
  current: GeneratedImageCaptureBudget,
  image: CapturedLocalImage,
  allowedRoots: readonly string[],
) {
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
      return {
        budget: attemptedBudget,
        byteBudgetExceeded: remainingBytes < MAX_CAPTURED_IMAGE_BYTES,
        image: null,
      }
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
