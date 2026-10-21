import { sessionLink } from '@shared/utils/session-link'
import { api } from '@/shared/lib/ipc'
import { useUIStore } from '@/shell/ui-store'

/**
 * Copy the Session link for a Session (ADR 0056) so it can be pasted into another Session, the
 * CLI, or a note. The menu or palette that triggered it has closed, so a toast confirms the copy.
 */
export function copySessionLink(sessionId: string) {
  const link = sessionLink(sessionId)
  api.copyToClipboard(link)
  useUIStore.getState().showToast(`Session link copied: ${link}`, 'success')
}
