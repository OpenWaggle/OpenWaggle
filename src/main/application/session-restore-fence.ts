import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { isSessionRemovalFenced } from './active-session-runs'

export const SESSION_RESTORE_FENCED_MESSAGE =
  'The Session is being archived or deleted; restore it once that finishes.'

/**
 * Restoring takes no removal fence of its own, so it is refused while one is held: a restore that
 * lands during a delete's teardown would otherwise be deleted with it (Settings > Archived items
 * deletes only what is still archived).
 */
export function refuseRestoreWhileRemovalFenced(sessionId: SessionId) {
  return isSessionRemovalFenced(sessionId)
    ? Effect.fail(new Error(SESSION_RESTORE_FENCED_MESSAGE))
    : Effect.void
}
