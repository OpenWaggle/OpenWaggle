import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import {
  isOpenQueuedMessageEdit,
  markHoldAbandoned,
  queuedMessageEditStashKey,
  useQueuedMessageEditStore,
} from './queued-message-edit-store'

const logger = createRendererLogger('queued-message-edit')

/** Releases a hold whose draft is going away; the Host also ends it when its lease runs out. */
function releaseHold(sessionId: string, followUpId: string, holdId: string) {
  void api
    .mutateSessionControl({
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      command: { operation: 'queue-edit-cancel', sessionId, followUpId, holdId },
    })
    .catch((cause: unknown) => {
      logger.warn('Failed to release an abandoned Follow-up edit hold', {
        message: cause instanceof Error ? cause.message : String(cause),
      })
    })
}

/**
 * Ends the Follow-up edits whose draft is being cleared (the Session was deleted or archived, or
 * the branch holding the edit was archived): releases their holds and forgets them. Returns the
 * stash keys to clear with the drafts, since there is no draft left to restore them into.
 *
 * An edit still `beginning` is only forgotten: `begin` sees that and releases the hold it gets.
 */
export function abandonQueuedMessageEdits(matchesContext: (contextKey: string) => boolean) {
  const { edits, setEdit } = useQueuedMessageEditStore.getState()
  const stashKeys: string[] = []
  for (const [sessionId, edit] of Object.entries(edits)) {
    if (!matchesContext(edit.contextKey)) continue
    if (isOpenQueuedMessageEdit(edit)) {
      // Before forgetting it: adoption must not re-open it while the release is on its way.
      markHoldAbandoned(edit.based.holdId)
      releaseHold(sessionId, edit.followUpId, edit.based.holdId)
    }
    setEdit(sessionId, null)
    stashKeys.push(queuedMessageEditStashKey(sessionId))
  }
  return stashKeys
}
