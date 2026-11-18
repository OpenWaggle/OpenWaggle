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
    // Not awaited: a deferred removal of a large directory must not delay Run settlement. A
    // later prepare waits for it, and the startup sweep retries a removal that failed.
    (release) =>
      Effect.sync(() => {
        void release().catch((error: unknown) => {
          logger.warn('Could not remove the session scratch directory after its run', {
            sessionId,
            error: String(error),
          })
        })
      }),
  )
}

/**
 * Run a turn and capture its resources while holding the Session scratch directory, so images the
 * agent embedded from `$TMPDIR` are still there for capture when the Session was archived mid-Run.
 */
export function runAndCaptureWithRetainedScratch<A, E, R, E2, R2>(input: {
  readonly sessionId: string
  readonly run: Effect.Effect<A, E, R>
  readonly capture: (result: A) => Effect.Effect<void, E2, R2>
}) {
  return withRetainedScratchDirectory(
    input.sessionId,
    Effect.gen(function* () {
      const result = yield* input.run
      yield* input.capture(result)
      return result
    }),
  )
}
