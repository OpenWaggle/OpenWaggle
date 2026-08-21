/**
 * Pin-related defaults for `SessionProjectionRepository` test stubs.
 *
 * Ten test layers implement the full port shape by hand. Pins are irrelevant to all of
 * them, so they spread these defaults instead of restating four no-op members each —
 * which also keeps those files under the 300-line limit.
 */
import * as Effect from 'effect/Effect'
import type { SessionProjectionRepositoryShape } from '../session-projection-repository'

export const PINNED_SESSION_REPOSITORY_STUB: Pick<
  SessionProjectionRepositoryShape,
  'listPinnedSessions' | 'pinSession' | 'unpinSession' | 'movePinnedSession'
> = {
  listPinnedSessions: () => Effect.succeed([]),
  pinSession: () => Effect.void,
  unpinSession: () => Effect.void,
  movePinnedSession: () => Effect.void,
}
