import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { createLogger } from '../logger'
import {
  currentSemanticDiscoverySourceRevision,
  getSessionHostEventRuntime,
  publishSessionHostEvent,
  subscribeSemanticDiscoverySourceChangesAfter,
} from '../session-host/session-host-events'
import { defaultSessionEmbeddingModel } from './multilingual-e5-session-embedding-model'
import { SqliteSessionSemanticProjection } from './sqlite-session-semantic-projection'
import { SqliteSessionTranscriptSemanticProjection } from './sqlite-session-transcript-semantic-projection'

const IDLE_POLL_INTERVAL = '2 seconds'
const FAILURE_RETRY_INTERVAL = '30 seconds'
const logger = createLogger('semantic-session-discovery')

function waitForSemanticDiscoverySourceChange(afterRevision: number) {
  return Effect.async<void>((resume) => {
    const release = subscribeSemanticDiscoverySourceChangesAfter(afterRevision, () => {
      resume(Effect.void)
    })
    return Effect.sync(release)
  })
}

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

function projectionLoop(projection: SqliteSessionSemanticProjection): Effect.Effect<void> {
  return Effect.gen(function* () {
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
        : Effect.gen(function* () {
            logger.warn('Semantic Session discovery preparation failed', { error: String(error) })
            const recorded = yield* projection
              .recordFailure(error instanceof Error ? error.message : String(error))
              .pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }))
            if (recorded) {
              yield* publishReadiness(projection).pipe(Effect.catchAll(() => Effect.void))
            }
            yield* Effect.sleep(FAILURE_RETRY_INTERVAL)
          }),
    ),
    Effect.flatMap(() => projectionLoop(projection)),
  )
}

function transcriptProjectionLoop(
  projection: SqliteSessionTranscriptSemanticProjection,
): Effect.Effect<void> {
  return Effect.gen(function* () {
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
        : Effect.gen(function* () {
            logger.warn('Semantic transcript preparation failed', { error: String(error) })
            yield* projection
              .recordFailure(error instanceof Error ? error.message : String(error))
              .pipe(Effect.catchAll(() => Effect.void))
            yield* Effect.sleep(FAILURE_RETRY_INTERVAL)
          }),
    ),
    Effect.flatMap(() => transcriptProjectionLoop(projection)),
  )
}

export const runSessionSemanticDiscoveryBackground = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const projection = new SqliteSessionSemanticProjection(sql, defaultSessionEmbeddingModel)
  const transcriptProjection = new SqliteSessionTranscriptSemanticProjection(
    sql,
    defaultSessionEmbeddingModel,
  )
  yield* Effect.forkScoped(projectionLoop(projection))
  yield* Effect.forkScoped(transcriptProjectionLoop(transcriptProjection))
})

export const SessionSemanticDiscoveryBackgroundLive = Layer.scopedDiscard(
  runSessionSemanticDiscoveryBackground,
)
