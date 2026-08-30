import { randomUUID } from 'node:crypto'
import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import {
  type ValidatedSessionResourceImage,
  validatedImageBytes,
} from '../domain/session-resource-image'
import { SessionResourceRepository } from '../ports/session-resource-repository'
import { SessionResourceStore } from '../ports/session-resource-store'
import {
  imageFileName,
  inspectManagedCopy,
  occurrence,
  occurrenceId,
  removeReplacedCopy,
  sha256,
} from './session-resource-capture-shared'
import type { CapturedImage } from './session-resource-extraction'

export function captureGeneratedImage(input: {
  readonly sessionId: SessionId
  readonly runId: string
  readonly image: CapturedImage
  readonly index: number
  readonly nodeId: string
  readonly createdAt: number
  readonly branchId?: string | null
  readonly validatedImage?: ValidatedSessionResourceImage
}) {
  return Effect.gen(function* () {
    const validated =
      input.validatedImage ?? validatedImageBytes(input.image.data, input.image.mimeType)
    if (!validated) return
    const repository = yield* SessionResourceRepository
    const digestHex = sha256(validated.bytes)
    const id = `${generatedImageOccurrencePrefix(input)}${digestHex}`
    const store = yield* SessionResourceStore
    const canonicalKey = `sha256:${digestHex}`
    const fileName = imageFileName(input.image.title, validated.mimeType)
    const existing = yield* repository.findByCanonicalKey(input.sessionId, canonicalKey)
    const existingCopy = existing
      ? yield* inspectManagedCopy(repository, store, input.sessionId, existing.id)
      : null
    if (existing && existingCopy?.readable) {
      yield* repository.upsert({
        id: existing.id,
        sessionId: input.sessionId,
        canonicalKey,
        kind: 'image',
        title: existing.title,
        mimeType: existing.mimeType ?? validated.mimeType,
        locator: existing.locator,
        managedPath: null,
        available: existing.available,
        occurrence: occurrence({
          id,
          nodeId: input.nodeId,
          branchId: input.branchId,
          actor: 'agent',
          activity: 'created',
          createdAt: input.createdAt,
        }),
        createdAt: existing.createdAt,
        updatedAt: input.createdAt,
      })
      return
    }
    const resourceId = randomUUID()
    const stored = yield* store.storeBytes({
      sessionId: input.sessionId,
      resourceId,
      fileName,
      bytes: validated.bytes,
    })
    const locator = `session-resource://${resourceId}`
    const resource = yield* repository
      .upsert({
        id: resourceId,
        sessionId: input.sessionId,
        canonicalKey,
        kind: 'image',
        title: fileName,
        mimeType: validated.mimeType,
        locator,
        managedPath: stored.path,
        available: true,
        occurrence: occurrence({
          id,
          nodeId: input.nodeId,
          branchId: input.branchId,
          actor: 'agent',
          activity: 'created',
          createdAt: input.createdAt,
        }),
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      })
      .pipe(
        Effect.tapError(() => store.remove(stored.path).pipe(Effect.catchAll(() => Effect.void))),
      )
    if (resource.locator !== locator) yield* store.remove(stored.path)
    else yield* removeReplacedCopy(store, existingCopy?.managedPath, stored.path)
  })
}

export function generatedImageOccurrencePrefix(input: {
  readonly sessionId: SessionId
  readonly nodeId: string | null
  readonly index: number
}) {
  return occurrenceId({
    ...input,
    suffix: `created:image:${String(input.index)}:`,
  })
}
