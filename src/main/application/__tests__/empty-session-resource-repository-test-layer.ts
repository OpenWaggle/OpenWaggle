import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SessionResourceRepository } from '../../ports/session-resource-repository'

export const EmptySessionResourceRepositoryTestLayer = Layer.succeed(SessionResourceRepository, {
  upsert: () => Effect.die(new Error('Session Resource upsert is unavailable in this test.')),
  list: () => Effect.succeed([]),
  listPage: () =>
    Effect.succeed({ resources: [], total: 0, nextCursor: null, orderRevision: 'none' }),
  findById: () => Effect.succeed(null),
  findByOccurrence: () => Effect.succeed(null),
  findByLocator: () => Effect.succeed(null),
  locateImage: () => Effect.succeed(null),
  findByCanonicalKey: () => Effect.succeed(null),
  rekey: () => Effect.die(new Error('Session Resource re-key is unavailable in this test.')),
  hasOccurrence: () => Effect.succeed(false),
  hasOccurrences: () => Effect.succeed(new Set()),
  findByOccurrences: () => Effect.succeed([]),
  listByNodeIds: () => Effect.succeed([]),
  listByNodeIdsPage: () =>
    Effect.succeed({ resources: [], total: 0, nextCursor: null, orderRevision: 'none' }),
  listManagedNodeIds: () => Effect.succeed([]),
  getContentLocation: () => Effect.succeed(null),
  getBackfillCursor: () => Effect.succeed(0),
  advanceBackfillCursor: () => Effect.void,
})
