import { extractInnerErrorMessage } from '@shared/domain/error-message-extraction'
import { classifyErrorMessage } from '@shared/types/errors'
import { ipcErrorMessage } from './ipc-error-message'

/**
 * The Host names a Session lifecycle step that failed before what went wrong, as
 * `SessionLifecyclePreparationError (prepare-session-lifecycle): `; what went wrong, such as a
 * worktree that no longer exists, is for the user, the step is not.
 */
const LIFECYCLE_PREPARATION_PREFIX = /^SessionLifecyclePreparationError \([^)]*\): /

/** A reason that starts by saying what failed, as `Branch summarization failed: `. */
const FAILURE_CLAUSE = /^[^:]{1,80} failed: /

/**
 * The toast for a Session operation that failed, such as a fork, clone, or branch switch. A
 * Session whose Pi file cannot be used says why in a sentence of its own, shown as it is, as
 * compaction shows it; anything else is `failed` with the reason, without Electron's transport
 * text, the Host's name for the step that failed, or a second account of what failed. A
 * provider's JSON error is shown by its message, as a failed Waggle turn is.
 */
export function sessionOperationFailureMessage(failed: string, error: unknown) {
  const message = ipcErrorMessage(error).replace(LIFECYCLE_PREPARATION_PREFIX, '')
  const info = classifyErrorMessage(message)
  if (info.code === 'pi-session-file-deleted') return info.userMessage
  // `failed` says it failed already, and a provider's JSON is shown by its message.
  const reason = message.replace(FAILURE_CLAUSE, '')
  return `${failed}: ${extractInnerErrorMessage(reason)?.message ?? reason}`
}
