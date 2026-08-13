import { appendMissingOptimisticUserMessages, sessionToUIMessages } from '../lib/useAgentChat.utils';
export const EMPTY_UI_MESSAGES = [];
export function createPendingRunWaiter() {
    let resolveRun = () => { };
    let rejectRun = (_error) => { };
    const promise = new Promise((resolve, reject) => {
        resolveRun = resolve;
        rejectRun = reject;
    });
    return {
        promise,
        waiter: {
            resolve: resolveRun,
            reject: rejectRun,
        },
    };
}
export function buildSessionSnapshotKey(session) {
    const lastMessage = session.messages[session.messages.length - 1];
    return `${String(session.updatedAt)}:${String(session.messages.length)}:${lastMessage ? String(lastMessage.id) : 'none'}`;
}
export function buildOptimisticMessagesKey(messages) {
    return messages.map((message) => message.id).join(':');
}
export function mergeSessionAndOptimisticMessages(session, optimisticUserMessages) {
    return appendMissingOptimisticUserMessages(sessionToUIMessages(session), optimisticUserMessages);
}
export function getMessagesForSession(messagesBySessionIdRef, targetSessionId) {
    return messagesBySessionIdRef.current.get(targetSessionId) ?? EMPTY_UI_MESSAGES;
}
export function setMessagesForSession(messagesBySessionIdRef, setMessagesBySessionId, setRunRenderMessages, targetSessionId, nextMessages, options = {}) {
    const nextMessagesBySessionId = new Map(messagesBySessionIdRef.current);
    nextMessagesBySessionId.set(targetSessionId, nextMessages);
    messagesBySessionIdRef.current = nextMessagesBySessionId;
    setMessagesBySessionId(nextMessagesBySessionId);
    if (options.cacheRunSnapshot) {
        setRunRenderMessages(targetSessionId, nextMessages);
    }
}
export function updateMessagesForSession(messagesBySessionIdRef, setMessagesBySessionId, setRunRenderMessages, targetSessionId, update, options = {}) {
    setMessagesForSession(messagesBySessionIdRef, setMessagesBySessionId, setRunRenderMessages, targetSessionId, update(getMessagesForSession(messagesBySessionIdRef, targetSessionId)), options);
}
