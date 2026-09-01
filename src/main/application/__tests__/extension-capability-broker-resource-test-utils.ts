import type { SessionResource } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import {
  SessionResourceRepository,
  type UpsertSessionResourceInput,
} from '../../ports/session-resource-repository'

export function makeSessionResourceRepositoryTestLayer(
  resources: SessionResource[],
  resourceUpserts: UpsertSessionResourceInput[],
) {
  return Layer.succeed(SessionResourceRepository, {
    upsert: (input) =>
      Effect.sync(() => {
        resourceUpserts.push(input)
        const existing = resources.find(
          (resource) =>
            resource.sessionId === input.sessionId && resource.canonicalKey === input.canonicalKey,
        )
        const occurrences = existing
          ? [
              ...existing.occurrences.filter((occurrence) => occurrence.id !== input.occurrence.id),
              input.occurrence,
            ]
          : [input.occurrence]
        const resource: SessionResource = {
          id: existing?.id ?? input.id,
          sessionId: input.sessionId,
          canonicalKey: input.canonicalKey,
          kind: existing?.kind ?? input.kind,
          title: input.title,
          mimeType: input.mimeType,
          locator: input.locator,
          managed: input.managedPath !== null,
          available: input.available,
          isSource: occurrences.some(
            (occurrence) => occurrence.activity === 'provided' || occurrence.activity === 'read',
          ),
          isOutput: occurrences.some(
            (occurrence) => occurrence.activity === 'created' || occurrence.activity === 'updated',
          ),
          occurrences,
          createdAt: existing?.createdAt ?? input.createdAt,
          updatedAt: input.updatedAt,
        }
        const existingIndex = resources.findIndex(({ id }) => id === resource.id)
        if (existingIndex >= 0) resources[existingIndex] = resource
        else resources.push(resource)
        return resource
      }),
    list: (sessionId) =>
      Effect.succeed(resources.filter((resource) => resource.sessionId === sessionId)),
    findByCanonicalKey: (sessionId, canonicalKey) =>
      Effect.succeed(
        resources.find(
          (resource) => resource.sessionId === sessionId && resource.canonicalKey === canonicalKey,
        ) ?? null,
      ),
    rekey: () => Effect.dieMessage('resource rekey is not configured for this broker test'),
    hasOccurrence: (sessionId, occurrenceId) =>
      Effect.succeed(
        resources.some(
          (resource) =>
            resource.sessionId === sessionId &&
            resource.occurrences.some((occurrence) => occurrence.id === occurrenceId),
        ),
      ),
    getContentLocation: () => Effect.succeed(null),
    getBackfillCursor: () => Effect.succeed(-1),
    advanceBackfillCursor: () => Effect.void,
  })
}
