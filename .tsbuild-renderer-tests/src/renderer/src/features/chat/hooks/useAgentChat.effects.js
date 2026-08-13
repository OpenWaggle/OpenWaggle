import { useEffect } from 'react';
import { api } from '@/shared/lib/ipc';
import { sessionToUIMessages } from '../lib/useAgentChat.utils';
import { hydrateSessionMessages, resetMissingSessionHydration } from './useAgentChat.hydration';
import { handleAgentStreamPayload } from './useAgentChat.stream-events';
function shouldIgnoreRunCompleted(payload, context) {
    return (payload.sessionId !== context.subscribedSessionId ||
        context.currentSessionIdRef.current !== context.subscribedSessionId);
}
function shouldFlushCompletedRunSnapshot(context) {
    return !(context.deferredSnapshotRefreshCountRef.current > 0 ||
        context.statusRef.current === 'submitted' ||
        context.statusRef.current === 'streaming' ||
        context.backgroundStreamingRef.current);
}
function handleRunCompletedPayload(payload, context) {
    if (shouldIgnoreRunCompleted(payload, context)) {
        return;
    }
    const terminalError = context.terminalRunErrorRef.current;
    context.foregroundStreamActiveRef.current = false;
    context.foregroundSessionIdRef.current = null;
    context.setBackgroundStreaming(false);
    context.backgroundStreamingRef.current = false;
    context.backgroundReconnectSessionIdRef.current = null;
    context.setCompactionStatus(null);
    if (!terminalError) {
        context.setStatus('ready');
    }
    context.agentRunActionsRef.current?.settlePendingRun(terminalError);
    context.terminalRunErrorRef.current = undefined;
    context.deferredRefreshSessionIdRef.current = context.subscribedSessionId;
    if (shouldFlushCompletedRunSnapshot(context)) {
        context.agentRunActionsRef.current?.flushDeferredSessionSnapshot();
    }
}
export function useSessionHydrationEffects(params) {
    const { sessionId, session, isSessionIdle, optimisticUserMessages, hasActiveRun, getRunRenderSnapshot, removeMatchedOptimisticUserMessages, context, } = params;
    useEffect(() => {
        if (!sessionId || !session) {
            resetMissingSessionHydration(context);
            return;
        }
        const activeRun = hasActiveRun(sessionId);
        const cachedRenderSnapshot = activeRun ? getRunRenderSnapshot(sessionId) : null;
        hydrateSessionMessages({
            sessionId,
            session,
            optimisticUserMessages,
            hasActiveRun: activeRun,
            cachedRenderMessages: cachedRenderSnapshot?.messages ?? null,
        }, context);
    }, [sessionId, session, hasActiveRun, getRunRenderSnapshot, optimisticUserMessages, context]);
    useEffect(() => {
        if (!sessionId || !session || !isSessionIdle) {
            return;
        }
        removeMatchedOptimisticUserMessages(sessionId, sessionToUIMessages(session));
    }, [sessionId, session, isSessionIdle, removeMatchedOptimisticUserMessages]);
}
export function useAgentEventEffects(params) {
    const { sessionId, streamEventContext, runCompletionContext } = params;
    useEffect(() => {
        if (!sessionId) {
            return;
        }
        const subscribedSessionId = sessionId;
        const unsubscribeStream = api.onAgentEvent((payload) => {
            handleAgentStreamPayload(payload, { ...streamEventContext, subscribedSessionId });
        });
        const unsubscribeCompleted = api.onRunCompleted((payload) => {
            handleRunCompletedPayload(payload, { ...runCompletionContext, subscribedSessionId });
        });
        return () => {
            unsubscribeStream();
            unsubscribeCompleted();
        };
    }, [sessionId, streamEventContext, runCompletionContext]);
    useEffect(() => {
        if (!sessionId) {
            return;
        }
        if (runCompletionContext.deferredRefreshSessionIdRef.current !== sessionId) {
            return;
        }
        runCompletionContext.agentRunActionsRef.current?.flushDeferredSessionSnapshot();
    }, [sessionId, runCompletionContext]);
}
