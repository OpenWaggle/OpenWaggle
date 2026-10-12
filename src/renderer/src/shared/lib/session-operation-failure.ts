import { classifyErrorMessage } from '@shared/types/errors'
import { ipcErrorMessage } from './ipc-error-message'

/**
 * The Host names a Session lifecycle step that failed before what went wrong, as
 * `SessionLifecyclePreparationError (prepare-session-lifecycle): `; what went wrong, such as a
 * worktree that no longer exists, is for the user, the step is not.
 */
const LIFECYCLE_PREPARATION_PREFIX = /^SessionLifecyclePreparationError \([^)]*\): /

/**
 * The toast for a Session operation that failed, such as a fork, clone, or branch switch. A
 * Session whose Pi file cannot be used says why in a sentence of its own, shown as it is, as
 * compaction shows it; anything else is `failed` with the reason, without Electron's transport
 * text or the Host's name for the step that failed.
 */
export function sessionOperationFailureMessage(failed: string, error: unknown) {
  const message = ipcErrorMessage(error).replace(LIFECYCLE_PREPARATION_PREFIX, '')
  const info = classifyErrorMessage(message)
  return info.code === 'pi-session-file-deleted' ? info.userMessage : `${failed}: ${message}`
}
