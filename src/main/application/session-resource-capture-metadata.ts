import { randomUUID } from 'node:crypto'
import type { SessionId } from '@shared/types/brand'
import type {
  SessionResourceActivity,
  SessionResourceActor,
  SessionResourceKind,
} from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import { SessionResourceRepository } from '../ports/session-resource-repository'
import { occurrence, occurrenceId } from './session-resource-capture-shared'

export interface MetadataResourceCaptureInput {
  readonly sessionId: SessionId
  readonly nodeId: string | null
  readonly branchId: string | null
  readonly occurrenceKey: string
  readonly canonicalKey: string
  readonly kind: SessionResourceKind
  readonly title: string
  readonly mimeType: string | null
  readonly locator: string | null
  readonly available: boolean
  readonly actor: SessionResourceActor
  readonly activity: SessionResourceActivity
  readonly label: string | null
  readonly createdAt: number
}

export function metadataResourceOccurrenceId(input: MetadataResourceCaptureInput) {
  return occurrenceId({
    sessionId: input.sessionId,
    nodeId: input.nodeId,
    suffix: input.occurrenceKey,
  })
}

/** Records an explicit, metadata-only resource without claiming managed-file ownership. */
export function captureMetadataResource(input: MetadataResourceCaptureInput) {
  return Effect.gen(function* () {
    const repository = yield* SessionResourceRepository
    const id = metadataResourceOccurrenceId(input)
    if (yield* repository.hasOccurrence(input.sessionId, id)) return

    const existing = yield* repository.findByCanonicalKey(input.sessionId, input.canonicalKey)
    yield* repository.upsert({
      id: existing?.id ?? randomUUID(),
      sessionId: input.sessionId,
      canonicalKey: input.canonicalKey,
      kind: input.kind,
      title: input.title,
      mimeType: input.mimeType,
      locator: input.locator,
      managedPath: null,
      available: input.available,
      occurrence: occurrence({
        id,
        nodeId: input.nodeId,
        branchId: input.branchId,
        actor: input.actor,
        activity: input.activity,
        label: input.label,
        locator: input.locator,
        createdAt: input.createdAt,
      }),
      createdAt: existing?.createdAt ?? input.createdAt,
      updatedAt: input.createdAt,
    })
  })
}
