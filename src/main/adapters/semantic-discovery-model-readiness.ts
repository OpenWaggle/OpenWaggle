import type {
  SemanticDiscoveryModelAvailability,
  SemanticDiscoveryReadiness,
} from '@shared/types/session-query-discovery'
import * as Effect from 'effect/Effect'
import type { SessionEmbeddingModel } from './multilingual-e5-session-embedding-model'
import {
  describeAvailability,
  type SessionEmbeddingModelAvailability,
  SessionEmbeddingModelUnavailableError,
} from './session-embedding-model-files'

function modelField(
  availability: Exclude<SessionEmbeddingModelAvailability, { readonly state: 'ready' }>,
): SemanticDiscoveryModelAvailability {
  return availability
}

/**
 * Adds the embedding model's availability to a readiness: while the model is not on disk (it is
 * fetched on first use) the readiness says so, with download progress or the failure, and its
 * reason, which replaces any stored one, explains that search matches words until it arrives.
 */
export function withModelAvailability(
  readiness: SemanticDiscoveryReadiness,
  model: SessionEmbeddingModel,
) {
  const availability = model.availability
  if (availability === undefined) return Effect.succeed(readiness)
  return Effect.promise(availability).pipe(
    Effect.map((current): SemanticDiscoveryReadiness => {
      if (current.state === 'ready') return readiness
      return {
        ...readiness,
        model: modelField(current),
        reason: describeAvailability(current),
      }
    }),
  )
}

/** Whether the model can embed a query now; a readiness without a model field says it can. */
export function semanticModelReady(readiness: SemanticDiscoveryReadiness) {
  return readiness.model === undefined
}

/** Whether Session discovery can search: the model is on disk and a snapshot of its revision exists. */
export function discoverySnapshotUsable(readiness: SemanticDiscoveryReadiness, revision: string) {
  return (
    semanticModelReady(readiness) &&
    (readiness.snapshotRevision ?? 0) > 0 &&
    readiness.modelRevision === revision
  )
}

/** A readiness no wait makes fresh: a recorded failure, or a model that is not on disk yet. */
export function cannotBecomeFresh(readiness: SemanticDiscoveryReadiness) {
  return readiness.status === 'failed' || !semanticModelReady(readiness)
}

/** The unavailable-model error under a projection failure, if that is what it was. */
export function modelUnavailableCause(error: unknown) {
  let current: unknown = error
  while (current instanceof Error) {
    if (current instanceof SessionEmbeddingModelUnavailableError) return current
    current = current.cause
  }
  return null
}
