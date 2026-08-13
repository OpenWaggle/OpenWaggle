import { SessionId } from '@shared/types/brand';
import { useSessionStore } from '@/features/sessions/state';
import { createRendererLogger } from '@/shared/lib/logger';
const logger = createRendererLogger('chat-store');
export function toSessionId(id) {
    return SessionId(String(id));
}
export function optionalSessionId(id) {
    return id ? toSessionId(id) : null;
}
export function isSameSessionId(left, right) {
    return left !== null && String(left) === String(right);
}
export function refreshSessionStoreForSession(sessionId, activeSessionId) {
    const sessionStore = useSessionStore.getState();
    if (isSameSessionId(activeSessionId, sessionId)) {
        void sessionStore.refreshSessionsAndTree(toSessionId(sessionId));
        return;
    }
    void sessionStore.loadSessions();
}
export function handleStoreError(err, action, setError) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to ${action}`, { message });
    setError(`Failed to ${action}: ${message}`);
}
export function toSummary(session) {
    return {
        id: session.id,
        title: session.title,
        projectPath: session.projectPath,
        messageCount: session.messages.length,
        archived: session.archived,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
    };
}
function shouldShowSummary(summary) {
    return summary.title !== 'New session' || (summary.messageCount ?? 0) > 0;
}
export function mergeSummary(summaries, summary) {
    const existingIndex = summaries.findIndex((item) => item.id === summary.id);
    if (!shouldShowSummary(summary)) {
        return existingIndex === -1
            ? [...summaries]
            : summaries.filter((item) => item.id !== summary.id);
    }
    if (existingIndex === -1) {
        return [summary, ...summaries];
    }
    return summaries.map((item) => (item.id === summary.id ? summary : item));
}
export function removeSummary(summaries, id) {
    return summaries.filter((summary) => summary.id !== id);
}
