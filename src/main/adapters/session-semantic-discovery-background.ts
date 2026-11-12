import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { awaitHostBackgroundTurn } from '../application/host-background-turn'
import { createLogger } from '../logger'
import {
  currentSemanticDiscoverySourceRevision,
  getSessionHostEventRuntime,
  publishSessionHostEvent,
  subscribeSemanticDiscoverySourceChangesAfter,
} from '../session-host/session-host-events'
import { defaultSessionEmbeddingModel } from './multilingual-e5-session-embedding-model'
import { modelUnavailableCause } from './semantic-discovery-model-readiness'
import { SqliteSessionSemanticProjection } from './sqlite-session-semantic-projection'
import { SqliteSessionTranscriptSemanticProjection } from './sqlite-session-transcript-semantic-projection'

const IDLE_POLL_INTERVAL = '2 seconds'
/**
 * A Session that changed is embedded once it has been quiet this long: a Run's messages each
 * re-queue it, and embedding after every one re-embedded the Session many times per Run (D3).
 */
const SEMANTIC_REEMBED_SETTLE_MS = 15_000
const FAILURE_RETRY_INTERVAL = '30 seconds'
const MODEL_RETRY_FLOOR_MS = 1_000
const logger = createLogger('semantic-session-discovery')

function waitForSemanticDiscoverySourceChange(afterRevision: number) {
  return Effect.async<void>((resume) => {
    const release = subscribeSemanticDiscoverySourceChangesAfter(afterRevision, () => {
      resume(Effect.void)
    })
    return Effect.sync(release)
  })
}

/**
 * Background work waits while no client is attached, after one attaches (A-F9), and while the
 * clients' requests are in flight (W12).
 */
export const awaitHostBackgroundWindow = awaitHostBackgroundTurn

function publishReadiness(projection: SqliteSessionSemanticProjection) {
  return projection.readiness().pipe(
    Effect.tap((readiness) =>
      Effect.sync(() => {
        publishSessionHostEvent({
          kind: 'semantic-discovery-readiness-changed',
          readiness,
        })
      }),
    ),
  )
}

function hostIsDraining() {
  return getSessionHostEventRuntime().liveness.isDraining()
}

/**
 * The model is fetched on first use: while it cannot be downloaded (offline, a failed download) a
 * batch waits for the next attempt instead of recording a projection failure. Readiness already
 * reports the model's state.
 */
function waitForModel(error: unknown) {
  const unavailable = modelUnavailableCause(error)
  if (unavailable === null) return null
  const availability = unavailable.availability
  const retryInMs = 'retryAt' in availability ? availability.retryAt - Date.now() : 0
  logger.info('Semantic Session discovery waits for its model', { state: availability.state })
  return Effect.sleep(Math.max(retryInMs, MODEL_RETRY_FLOOR_MS))
}

function projectionLoop(projection: SqliteSessionSemanticProjection): Effect.Effect<void> {
  return Effect.gen(function* () {
    yield* awaitHostBackgroundWindow
    const sourceRevision = currentSemanticDiscoverySourceRevision()
    const releaseLiveness = yield* Effect.try(() =>
      getSessionHostEventRuntime().liveness.acquire('semantic-preparation'),
    )
    const result = yield* projection
      .prepareNextBatch()
      .pipe(Effect.ensuring(Effect.sync(releaseLiveness)))
    if (result.prepared > 0) yield* publishReadiness(projection)
    if (result.prepared === 0) {
      yield* Effect.raceFirst(
        waitForSemanticDiscoverySourceChange(sourceRevision),
        Effect.sleep(IDLE_POLL_INTERVAL),
      )
    }
  }).pipe(
    Effect.catchAll((error) =>
      hostIsDraining()
        ? Effect.never
        : (waitForModel(error) ??
          Effect.gen(function* () {
            logger.warn('Semantic Session discovery preparation failed', { error: String(error) })
            const recorded = yield* projection
              .recordFailure(error instanceof Error ? error.message : String(error))
              .pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }))
            if (recorded) {
              yield* publishReadiness(projection).pipe(Effect.catchAll(() => Effect.void))
            }
            yield* Effect.sleep(FAILURE_RETRY_INTERVAL)
          })),
    ),
    Effect.flatMap(() => projectionLoop(projection)),
  )
}

function transcriptProjectionLoop(
  projection: SqliteSessionTranscriptSemanticProjection,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    yield* awaitHostBackgroundWindow
    const sourceRevision = currentSemanticDiscoverySourceRevision()
    const releaseLiveness = yield* Effect.try(() =>
      getSessionHostEventRuntime().liveness.acquire('semantic-preparation'),
    )
    const result = yield* projection
      .prepareNextBatch()
      .pipe(Effect.ensuring(Effect.sync(releaseLiveness)))
    if (result.prepared === 0) {
      yield* Effect.raceFirst(
        waitForSemanticDiscoverySourceChange(sourceRevision),
        Effect.sleep(IDLE_POLL_INTERVAL),
      )
    }
  }).pipe(
    Effect.catchAll((error) =>
      hostIsDraining()
        ? Effect.never
        : (waitForModel(error) ??
          Effect.gen(function* () {
            logger.warn('Semantic transcript preparation failed', { error: String(error) })
            yield* projection
              .recordFailure(error instanceof Error ? error.message : String(error))
              .pipe(Effect.catchAll(() => Effect.void))
            yield* Effect.sleep(FAILURE_RETRY_INTERVAL)
          })),
    ),
    Effect.flatMap(() => transcriptProjectionLoop(projection)),
  )
}

export const runSessionSemanticDiscoveryBackground = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const projection = new SqliteSessionSemanticProjection(
    sql,
    defaultSessionEmbeddingModel,
    undefined,
    { settleMs: SEMANTIC_REEMBED_SETTLE_MS },
  )
  const transcriptProjection = new SqliteSessionTranscriptSemanticProjection(
    sql,
    defaultSessionEmbeddingModel,
  )
  // Download progress and failures of the model, fetched on first use, reach clients as readiness.
  yield* Effect.acquireRelease(
    Effect.sync(() =>
      defaultSessionEmbeddingModel.onAvailabilityChange(() => {
        Effect.runFork(publishReadiness(projection).pipe(Effect.catchAll(() => Effect.void)))
      }),
    ),
    (release) => Effect.sync(release),
  )
  yield* Effect.forkScoped(projectionLoop(projection))
  yield* Effect.forkScoped(transcriptProjectionLoop(transcriptProjection))
})
