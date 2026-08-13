import { useState } from 'react';
/**
 * Manages the optimistic steered user turn — an immediate preview
 * of the user's steered message before the server confirms it.
 * Auto-clears when the real message appears in the hydrated messages.
 */
export function useOptimisticSteeredTurn(hydratedMessages, sessionId, isSessionIdle, buildClientUserMessage, messagesRef) {
    const [optimisticSteeredUserTurn, setOptimisticSteeredUserTurn] = useState(null);
    // Both clears below adjust state during render (the React-recommended
    // prev-value comparison) rather than in an effect. Routing them through an
    // effect commits one render showing the stale optimistic turn first
    // (react-doctor/no-adjust-state-on-prop-change).
    const [previousSessionId, setPreviousSessionId] = useState(sessionId);
    if (previousSessionId !== sessionId) {
        setPreviousSessionId(sessionId);
        setOptimisticSteeredUserTurn(null);
    }
    // Clear the optimistic turn once the real steered message has arrived.
    if (optimisticSteeredUserTurn &&
        isSessionIdle &&
        hasMatchingSteeredUserTurn(hydratedMessages, optimisticSteeredUserTurn)) {
        setOptimisticSteeredUserTurn(null);
    }
    const visibleMessages = insertOptimisticSteeredUserTurn(hydratedMessages, optimisticSteeredUserTurn);
    return {
        visibleMessages,
        previewSteeredUserTurn: (payload) => {
            const content = buildClientUserMessage(payload);
            const optimisticTurnId = createOptimisticTurnId();
            setOptimisticSteeredUserTurn({
                id: optimisticTurnId,
                content,
                baselineLength: messagesRef.current.length,
                message: createOptimisticUserMessage(content, optimisticTurnId),
            });
            return () => {
                setOptimisticSteeredUserTurn((current) => current?.id === optimisticTurnId ? null : current);
            };
        },
    };
}
// ─── Helpers ─────────────────────────────────────────────────
function createOptimisticTurnId() {
    const randomUUID = globalThis.crypto?.randomUUID;
    if (typeof randomUUID === 'function') {
        return randomUUID.call(globalThis.crypto);
    }
    return `optimistic-steer-${Date.now()}`;
}
function createOptimisticUserMessage(content, id) {
    return {
        id: `optimistic-steer-${id}`,
        role: 'user',
        parts: [{ type: 'text', content }],
        createdAt: new Date(),
    };
}
function getUIMessageText(message) {
    return message.parts
        .filter((part) => part.type === 'text')
        .map((part) => part.content)
        .join('\n\n');
}
function hasMatchingSteeredUserTurn(messages, optimisticSteeredUserTurn) {
    const suffix = messages.slice(optimisticSteeredUserTurn.baselineLength);
    return suffix.some((message) => message.role === 'user' && getUIMessageText(message) === optimisticSteeredUserTurn.content);
}
function insertOptimisticSteeredUserTurn(messages, optimisticSteeredUserTurn) {
    if (!optimisticSteeredUserTurn) {
        return messages;
    }
    if (hasMatchingSteeredUserTurn(messages, optimisticSteeredUserTurn)) {
        return messages;
    }
    const prefix = messages.slice(0, optimisticSteeredUserTurn.baselineLength);
    const suffix = messages.slice(optimisticSteeredUserTurn.baselineLength);
    return [...prefix, optimisticSteeredUserTurn.message, ...suffix];
}
