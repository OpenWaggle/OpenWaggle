import { extractInnerErrorMessage } from '@shared/domain/error-message-extraction'
import { isSessionWriterBusyMessage } from '@shared/domain/session-writer-messages'
import { classifyErrorMessage } from '@shared/types/errors'
import { ipcErrorMessage } from './ipc-error-message'

/**
 * The Host names a Session lifecycle step that failed before what went wrong, as
 * `SessionLifecyclePreparationError (prepare-session-lifecycle): `; what went wrong, such as a
 * worktree that no longer exists, is for the user, the step is not.
 */
const LIFECYCLE_PREPARATION_PREFIX = /^SessionLifecyclePreparationError \([^)]*\): /

/**
 * The Host refuses a fork, clone, branch switch, or compaction while another writer, such as an
 * active Run or a compaction, holds the Session. Its message names internal ids and writer kinds.
 */
const SESSION_BUSY_REASON =
  'this Session is busy. Wait for what it is doing to finish, then try again.'

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
  if (isSessionWriterBusyMessage(message)) return `${failed}: ${SESSION_BUSY_REASON}`
  // `failed` says it failed already, and a provider's JSON is shown by its message.
  const reason = message.replace(FAILURE_CLAUSE, '')
  return `${failed}: ${extractInnerErrorMessage(reason)?.message ?? reason}`
}
