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
          ? existing.occurrences.some((occurrence) => occurrence.id === input.occurrence.id)
            ? existing.occurrences
            : [...existing.occurrences, input.occurrence]
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
    listPage: (sessionId, input) => {
      const matching = resources.filter(
        (resource) =>
          resource.sessionId === sessionId &&
          (input.view === 'all' ||
            (input.view === 'images' && resource.kind === 'image') ||
            (input.view === 'sources' && resource.isSource) ||
            (input.view === 'outputs' && resource.isOutput)),
      )
      return Effect.succeed({
        resources: matching.slice(0, input.limit),
        total: matching.length,
        nextCursor: null,
        orderRevision: 'none',
      })
    },
    findById: (sessionId, resourceId) =>
      Effect.succeed(
        resources.find(
          (resource) => resource.sessionId === sessionId && resource.id === resourceId,
        ) ?? null,
      ),
    findByOccurrence: (sessionId, occurrenceId) =>
      Effect.succeed(
        resources.find(
          (resource) =>
            resource.sessionId === sessionId &&
            resource.occurrences.some((occurrence) => occurrence.id === occurrenceId),
        ) ?? null,
      ),
    findByLocator: (sessionId, kind, locator) =>
      Effect.succeed(
        resources.find(
          (resource) =>
            resource.sessionId === sessionId &&
            resource.kind === kind &&
            resource.locator === locator,
        ) ?? null,
      ),
    locateImage: () => Effect.succeed(null),
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
    hasOccurrences: (sessionId, occurrenceIds) =>
      Effect.succeed(
        new Set(
          occurrenceIds.filter((occurrenceId) =>
            resources.some(
              (resource) =>
                resource.sessionId === sessionId &&
                resource.occurrences.some((occurrence) => occurrence.id === occurrenceId),
            ),
          ),
        ),
      ),
    listByNodeIds: (sessionId, nodeIds, kind, limit) =>
      Effect.succeed(
        resources
          .filter(
            (resource) =>
              resource.sessionId === sessionId &&
              (kind === null || resource.kind === kind) &&
              resource.occurrences.some(
                (occurrence) => occurrence.nodeId !== null && nodeIds.includes(occurrence.nodeId),
              ),
          )
          .slice(0, limit),
      ),
    listByNodeIdsPage: () =>
      Effect.succeed({ resources: [], total: 0, nextCursor: null, orderRevision: 'none' }),
    listManagedNodeIds: (sessionId, limit) =>
      Effect.succeed(
        [
          ...new Set(
            resources
              .filter((resource) => resource.sessionId === sessionId && resource.managed)
              .flatMap((resource) => resource.occurrences.map(({ nodeId }) => nodeId))
              .filter((nodeId): nodeId is string => nodeId !== null),
          ),
        ].slice(0, limit),
      ),
    getContentLocation: () => Effect.succeed(null),
    getBackfillCursor: () => Effect.succeed(-1),
    advanceBackfillCursor: () => Effect.void,
  })
}
