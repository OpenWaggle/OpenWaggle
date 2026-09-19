import type { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { useComposerStore } from '@/features/composer/state'

export function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  // Electron adds transport context to rejected invokes. Keep the actionable reason in toasts.
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/u, '')
}

export function clearComposerDraftsForSessions(sessions: readonly Pick<SessionSummary, 'id'>[]) {
  for (const session of sessions) {
    useComposerStore.getState().clearScopedDraftsForSession(String(session.id))
  }
}

export function clearComposerDraftForSession(sessionId: SessionId) {
  useComposerStore.getState().clearScopedDraftsForSession(String(sessionId))
}
