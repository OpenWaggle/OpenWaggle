import { useComposerStore } from '@/features/composer/state';
export function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
export function clearComposerDraftsForSessions(sessions) {
    for (const session of sessions) {
        useComposerStore.getState().clearScopedDraftsForSession(String(session.id));
    }
}
export function clearComposerDraftForSession(sessionId) {
    useComposerStore.getState().clearScopedDraftsForSession(String(sessionId));
}
