import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SessionResourceRepository } from '../../ports/session-resource-repository'

export const EmptySessionResourceRepositoryTestLayer = Layer.succeed(SessionResourceRepository, {
  upsert: () => Effect.die(new Error('Session Resource upsert is unavailable in this test.')),
  list: () => Effect.succeed([]),
  findByCanonicalKey: () => Effect.succeed(null),
  rekey: () => Effect.die(new Error('Session Resource re-key is unavailable in this test.')),
  hasOccurrence: () => Effect.succeed(false),
  getContentLocation: () => Effect.succeed(null),
  getBackfillCursor: () => Effect.succeed(0),
  advanceBackfillCursor: () => Effect.void,
})
