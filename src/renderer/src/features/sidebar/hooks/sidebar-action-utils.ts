import type { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { useComposerStore } from '@/features/composer/state'

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function clearComposerDraftsForSessions(sessions: readonly Pick<SessionSummary, 'id'>[]) {
  for (const session of sessions) {
    useComposerStore.getState().clearScopedDraftsForSession(String(session.id))
  }
}

export function clearComposerDraftForSession(sessionId: SessionId) {
  useComposerStore.getState().clearScopedDraftsForSession(String(sessionId))
}
