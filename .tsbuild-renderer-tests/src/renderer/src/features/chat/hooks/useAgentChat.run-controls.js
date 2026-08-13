import { api } from '@/shared/lib/ipc';
import { createOptimisticUserMessage } from '../lib/useAgentChat.utils';
import { createPendingRunWaiter, updateMessagesForSession } from './useAgentChat.message-cache';
function normalizeError(error) {
    return error instanceof Error ? error : new Error(String(error));
}
function clearRunPointers(refs) {
    refs.foregroundStreamActiveRef.current = false;
    refs.foregroundSessionIdRef.current = null;
    refs.terminalRunErrorRef.current = undefined;
}
function resetRunUiState(params) {
    clearRunPointers(params.refs);
    params.setBackgroundStreaming(false);
    params.refs.backgroundStreamingRef.current = false;
    params.refs.backgroundReconnectSessionIdRef.current = null;
    params.setCompactionStatus(null);
    params.setStatus('ready');
}
function shouldDeferSnapshotRefresh(refs) {
    return (refs.deferredSnapshotRefreshCountRef.current > 0 ||
        refs.statusRef.current === 'submitted' ||
        refs.statusRef.current === 'streaming' ||
        refs.backgroundStreamingRef.current);
}
function settlePendingRun(refs, nextError) {
    const pending = refs.pendingRunWaiterRef.current;
    refs.pendingRunWaiterRef.current = null;
    if (!pending) {
        return;
    }
    if (nextError) {
        pending.reject(nextError);
        return;
    }
    pending.resolve();
}
export function createAgentRunControls(params) {
    const { refs, sessionId } = params;
    async function refreshSessionSnapshot(targetSessionId) {
        const nextSession = await api.getSessionDetail(targetSessionId);
        if (!nextSession || refs.currentSessionIdRef.current !== targetSessionId) {
            return;
        }
        params.upsertSession(nextSession);
    }
    function flushDeferredSessionSnapshot() {
        const targetSessionId = refs.deferredRefreshSessionIdRef.current;
        if (!targetSessionId || shouldDeferSnapshotRefresh(refs)) {
            return;
        }
        if (refs.currentSessionIdRef.current !== targetSessionId) {
            refs.deferredRefreshSessionIdRef.current = null;
            return;
        }
        refs.deferredRefreshSessionIdRef.current = null;
        void refreshSessionSnapshot(targetSessionId);
    }
    async function withDeferredSnapshotRefresh(operation) {
        refs.deferredSnapshotRefreshCountRef.current += 1;
        try {
            return await operation();
        }
        finally {
            refs.deferredSnapshotRefreshCountRef.current = Math.max(0, refs.deferredSnapshotRefreshCountRef.current - 1);
            flushDeferredSessionSnapshot();
        }
    }
    function startForegroundRun(targetSessionId) {
        const { promise, waiter } = createPendingRunWaiter();
        refs.pendingRunWaiterRef.current = waiter;
        refs.foregroundStreamActiveRef.current = true;
        refs.foregroundSessionIdRef.current = targetSessionId;
        refs.terminalRunErrorRef.current = undefined;
        params.setBackgroundStreaming(false);
        params.setError(undefined);
        params.setStatus('submitted');
        return promise;
    }
    async function dispatchAgentSend(payload, waggleConfig) {
        if (!sessionId) {
            return;
        }
        const targetSessionId = sessionId;
        const runPromise = startForegroundRun(targetSessionId);
        const sendPromise = waggleConfig
            ? api.sendWaggleMessage(targetSessionId, payload, params.model, waggleConfig)
            : api.sendMessage(targetSessionId, payload, params.model);
        try {
            await sendPromise;
            await runPromise;
        }
        catch (runError) {
            const normalizedError = normalizeError(runError);
            if (refs.foregroundSessionIdRef.current === targetSessionId) {
                refs.pendingRunWaiterRef.current = null;
                clearRunPointers(refs);
            }
            if (refs.currentSessionIdRef.current === targetSessionId) {
                params.setError(normalizedError);
                params.setStatus('error');
                refs.terminalRunErrorRef.current = normalizedError;
            }
            throw normalizedError;
        }
    }
    async function sendUserPayload(payload, waggleConfig) {
        if (!sessionId) {
            return;
        }
        const optimisticUserMessage = createOptimisticUserMessage(payload);
        params.addOptimisticUserMessage(sessionId, optimisticUserMessage);
        updateMessagesForSession(refs.messagesBySessionIdRef, params.setMessagesBySessionId, params.setRunRenderMessages, sessionId, (currentMessages) => [...currentMessages, optimisticUserMessage], { cacheRunSnapshot: true });
        await dispatchAgentSend(payload, waggleConfig);
    }
    function stop() {
        if (sessionId) {
            void api.cancelAgent(sessionId).catch((cancelError) => {
                const normalizedError = normalizeError(cancelError);
                params.setError(normalizedError);
                params.setStatus('error');
                refs.terminalRunErrorRef.current = normalizedError;
            });
        }
        settlePendingRun(refs);
        resetRunUiState(params);
    }
    async function steer() {
        if (sessionId) {
            await api.steerAgent(sessionId);
        }
        settlePendingRun(refs);
        resetRunUiState(params);
    }
    return {
        runActions: {
            flushDeferredSessionSnapshot,
            settlePendingRun: (nextError) => settlePendingRun(refs, nextError),
        },
        withDeferredSnapshotRefresh,
        sendUserPayload,
        stop,
        steer,
    };
}
