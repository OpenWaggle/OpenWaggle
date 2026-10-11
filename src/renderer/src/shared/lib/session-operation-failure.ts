import { classifyErrorMessage } from '@shared/types/errors'
import { ipcErrorMessage } from './ipc-error-message'

/**
 * The toast for a Session operation that failed, such as a fork, clone, or branch switch. A
 * Session whose Pi file cannot be used says why in a sentence of its own, shown as it is, as
 * compaction shows it; anything else is `failed` with the reason, without Electron's transport
 * text.
 */
export function sessionOperationFailureMessage(failed: string, error: unknown) {
  const message = ipcErrorMessage(error)
  const info = classifyErrorMessage(message)
  return info.code === 'pi-session-file-deleted' ? info.userMessage : `${failed}: ${message}`
}
