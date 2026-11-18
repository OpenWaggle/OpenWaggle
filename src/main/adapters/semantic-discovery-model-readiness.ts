import type {
  SemanticDiscoveryModelAvailability,
  SemanticDiscoveryReadiness,
} from '@shared/types/session-query-discovery'
import * as Effect from 'effect/Effect'
import type { SessionEmbeddingModel } from './multilingual-e5-session-embedding-model'
import {
  describeAvailability,
  SessionEmbeddingModelUnavailableError,
} from './session-embedding-model-files'

/**
 * The readiness status while the model is not on disk: `preparing` while it is missing or
 * downloading, `unavailable` while a download waits to retry. A stored `failed` or `unavailable`
 * stays, so it is never reported as more ready than the index is.
 */
function statusWithoutModel(
  status: SemanticDiscoveryReadiness['status'],
  availability: SemanticDiscoveryModelAvailability,
) {
  if (status === 'failed' || status === 'unavailable') return status
  const withoutModel: SemanticDiscoveryReadiness['status'] =
    availability.state === 'missing' || availability.state === 'downloading'
      ? 'preparing'
      : 'unavailable'
  return withoutModel
}

/**
 * Adds the embedding model's availability to a readiness: while the model is not on disk (it is
 * fetched on first use) the readiness says so, with download progress or the failure, a status
 * other than `ready`, and its reason, which replaces any stored one, explains that search matches
 * words until it arrives.
 */
export function withModelAvailability(
  readiness: SemanticDiscoveryReadiness,
  model: SessionEmbeddingModel,
) {
  const availability = model.availability
  if (availability === undefined) return Effect.succeed(readiness)
  return Effect.promise(availability).pipe(
    Effect.map((current) => {
      if (current.state === 'ready') return readiness
      const unavailable: SemanticDiscoveryReadiness = {
        ...readiness,
        status: statusWithoutModel(readiness.status, current),
        model: current,
        reason: describeAvailability(current),
      }
      return unavailable
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

/**
 * A readiness no wait makes fresh: a recorded failure, or a model download that failed and waits
 * to retry. A model that is missing or downloading can arrive within the wait: reading readiness
 * starts its download, so `--require-fresh` waits for it as it waits for the index. So can a failed
 * one whose `retryAt` has come: that read starts the retry, though it reports the old failure.
 */
export function cannotBecomeFresh(readiness: SemanticDiscoveryReadiness, now = Date.now()) {
  if (readiness.status === 'failed') return true
  const model = readiness.model
  if (model === undefined || (model.state !== 'failed' && model.state !== 'offline')) return false
  return model.retryAt === undefined || model.retryAt > now
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
