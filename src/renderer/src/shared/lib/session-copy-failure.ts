import { classifyErrorMessage } from '@shared/types/errors'

/**
 * The toast for a fork or clone that failed. A Session whose Pi file cannot be used says why in a
 * sentence of its own, shown as it is, as compaction shows it; anything else names the action.
 */
export function sessionCopyFailureMessage(action: 'fork' | 'clone', message: string) {
  const info = classifyErrorMessage(message)
  return info.code === 'pi-session-file-deleted'
    ? info.userMessage
    : `Failed to ${action} session: ${message}`
}
