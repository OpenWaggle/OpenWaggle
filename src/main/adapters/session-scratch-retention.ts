import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import { retainSessionScratchDirectory } from '../utils/session-scratch-directory'

const logger = createLogger('session-scratch-retention')

/**
 * Hold the Session scratch directory while `run` runs, so archiving a Session mid-Run defers the
 * removal until `run` ends instead of deleting temp files a running tool, or the resource capture
 * that follows the Run, still uses. Holds nest: the removal waits for the outermost one.
 */
export function withRetainedScratchDirectory<A, E, R>(
  sessionId: string,
  run: Effect.Effect<A, E, R>,
) {
  return Effect.acquireUseRelease(
    Effect.sync(() => retainSessionScratchDirectory(sessionId)),
    () => run,
    (release) =>
      Effect.tryPromise(release).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            logger.warn('Could not remove the session scratch directory after its run', {
              sessionId,
              error: String(error.error),
            })
          }),
        ),
      ),
  )
}
