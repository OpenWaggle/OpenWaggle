import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import { app } from 'electron'
import { createLogger } from '../logger'
import { sweepOrphanedModelDownloads } from '../utils/model-download-temp-sweep'
import { sessionScratchRoot } from '../utils/session-scratch-directory'
import { sweepSessionScratchDirectories } from '../utils/session-scratch-sweep'

const logger = createLogger('session-scratch-sweep')

/** Remove scratch directories of Sessions that were deleted or archived while no Host ran. */
export function sweepSessionScratchDirectoriesOnce(
  options: { readonly root?: string; readonly now?: number } = {},
) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ readonly id: string }>`SELECT id FROM sessions WHERE archived = 0`
    const removed = yield* Effect.tryPromise(() =>
      sweepSessionScratchDirectories(
        rows.map((row) => row.id),
        options.root ?? sessionScratchRoot(),
        options.now ?? Date.now(),
      ),
    )
    if (removed > 0) logger.info('Removed stale session scratch directories', { removed })
    return removed
  })
}

const MODELS_DIRECTORY_NAME = 'models'

/** Remove model downloads an interrupted Whisper or embedding download left in `<userData>/models`. */
export function sweepOrphanedModelDownloadsOnce(
  options: { readonly root?: string; readonly now?: number } = {},
) {
  return Effect.gen(function* () {
    const root = options.root ?? path.join(app.getPath('userData'), MODELS_DIRECTORY_NAME)
    const result = yield* Effect.tryPromise(() =>
      sweepOrphanedModelDownloads(root, options.now ?? Date.now()),
    )
    if (result.removedFiles > 0) logger.info('Removed orphaned model downloads', result)
    return result
  })
}

function warnUnlessInterrupted(message: string) {
  return Effect.catchAllCause((cause: Cause.Cause<unknown>) =>
    Effect.sync(() => {
      if (Cause.isInterruptedOnly(cause)) return
      logger.warn(message, { cause: Cause.pretty(cause) })
    }),
  )
}

/**
 * The Host's disk sweeps once it serves clients: stale Session scratch directories, then orphaned
 * model downloads. Each failure is logged alone.
 */
export const runSessionScratchSweepBackground = Effect.forkScoped(
  Effect.gen(function* () {
    yield* sweepSessionScratchDirectoriesOnce().pipe(
      warnUnlessInterrupted('Session scratch directory sweep failed'),
    )
    yield* sweepOrphanedModelDownloadsOnce().pipe(
      warnUnlessInterrupted('Orphaned model download sweep failed'),
    )
  }),
)
