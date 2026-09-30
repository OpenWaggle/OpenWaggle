import * as SqlClient from '@effect/sql/SqlClient'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import {
  sessionScratchRoot,
  sweepSessionScratchDirectories,
} from '../utils/session-scratch-directory'

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

export const runSessionScratchSweepBackground = Effect.forkScoped(
  sweepSessionScratchDirectoriesOnce().pipe(
    Effect.catchAllCause((cause) =>
      Effect.sync(() => {
        if (Cause.isInterruptedOnly(cause)) return
        logger.warn('Session scratch directory sweep failed', { cause: Cause.pretty(cause) })
      }),
    ),
  ),
)
