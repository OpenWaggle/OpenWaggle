import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useBackgroundRunStore } from '@/features/chat/state/background-run-store';
import { useChatStore } from '@/features/chat/state/chat-store';
import { selectOptimisticUserMessages, useOptimisticUserMessageStore, } from '@/features/chat/state/optimistic-user-message-store';
import { api } from '@/shared/lib/ipc';
import { buildClientUserMessage } from '../lib/useAgentChat.utils';
import { useAgentEventEffects, useSessionHydrationEffects, } from './useAgentChat.effects';
import { EMPTY_UI_MESSAGES } from './useAgentChat.message-cache';
import { createAgentRunControls } from './useAgentChat.run-controls';
import { useOptimisticSteeredTurn } from './useOptimisticSteeredTurn';
class StreamSignalVersionStore extends EventTarget {
    value = 0;
    get current() {
        return this.value;
    }
    set current(value) {
        if (this.value === value) {
            return;
        }
        this.value = value;
        this.dispatchEvent(new Event('change'));
    }
    getSnapshot = () => this.value;
    subscribe = (listener) => {
        this.addEventListener('change', listener);
        return () => this.removeEventListener('change', listener);
    };
}
function valueForSession(valuesBySessionId, sessionId, empty) {
    if (sessionId === null) {
        return empty;
    }
    return valuesBySessionId.get(sessionId) ?? empty;
}
async function respondAgentInteraction(interaction, response) {
    const result = await api.respondAgentInteraction({
        sessionId: interaction.sessionId,
        runId: interaction.runId,
        interactionId: interaction.interactionId,
        kind: interaction.kind,
        response,
    });
    if (!result.ok) {
        throw new Error(result.error.message);
    }
}
export function useAgentChat(sessionId, session, model, _thinkingLevel) {
    const upsertSession = useChatStore((state) => state.upsertSession);
    const hasActiveRun = useBackgroundRunStore((state) => state.hasActiveRun);
    const getRunRenderSnapshot = useBackgroundRunStore((state) => state.getRunRenderSnapshot);
    const setRunRenderMessages = useBackgroundRunStore((state) => state.setRunRenderMessages);
    const optimisticUserMessages = useOptimisticUserMessageStore(selectOptimisticUserMessages(sessionId));
    const addOptimisticUserMessage = useOptimisticUserMessageStore((state) => state.add);
    const removeMatchedOptimisticUserMessages = useOptimisticUserMessageStore((state) => state.removeMatched);
    const [messagesBySessionId, setMessagesBySessionId] = useState(() => new Map());
    const [agentInteractionsBySessionId, setAgentInteractionsBySessionId] = useState(() => new Map());
    const [agentCustomMessagesBySessionId, setAgentCustomMessagesBySessionId] = useState(() => new Map());
    const [agentInteractionEventsBySessionId, setAgentInteractionEventsBySessionId] = useState(() => new Map());
    const [status, setStatus] = useState('ready');
    const [error, setError] = useState(undefined);
    const [backgroundStreaming, setBackgroundStreaming] = useState(false);
    const [compactionStatus, setCompactionStatus] = useState(null);
    const messagesBySessionIdRef = useRef(messagesBySessionId);
    const agentInteractionsBySessionIdRef = useRef(agentInteractionsBySessionId);
    const agentCustomMessagesBySessionIdRef = useRef(agentCustomMessagesBySessionId);
    const agentInteractionEventsBySessionIdRef = useRef(agentInteractionEventsBySessionId);
    const messages = valueForSession(messagesBySessionId, sessionId, EMPTY_UI_MESSAGES);
    const agentInteractions = valueForSession(agentInteractionsBySessionId, sessionId, []);
    const agentCustomMessages = valueForSession(agentCustomMessagesBySessionId, sessionId, []);
    const agentInteractionEvents = valueForSession(agentInteractionEventsBySessionId, sessionId, []);
    const isLoading = backgroundStreaming || (status !== 'ready' && status !== 'error');
    const isSessionIdle = !isLoading;
    const currentSessionIdRef = useRef(sessionId);
    const statusRef = useRef(status);
    const backgroundStreamingRef = useRef(backgroundStreaming);
    const messagesRef = useRef(messages);
    const foregroundStreamActiveRef = useRef(false);
    const foregroundSessionIdRef = useRef(null);
    const terminalRunErrorRef = useRef(undefined);
    const backgroundReconnectSessionIdRef = useRef(null);
    const [streamSignalVersionRef] = useState(() => new StreamSignalVersionStore());
    const streamSignalVersion = useSyncExternalStore(streamSignalVersionRef.subscribe, streamSignalVersionRef.getSnapshot, streamSignalVersionRef.getSnapshot);
    const deferredRefreshSessionIdRef = useRef(null);
    const deferredSnapshotRefreshCountRef = useRef(0);
    const lastHydratedSessionIdRef = useRef(null);
    const lastHydratedSnapshotKeyRef = useRef(null);
    const lastHydratedOptimisticKeyRef = useRef(null);
    const pendingRunWaiterRef = useRef(null);
    const agentRunActionsRef = useRef(null);
    useLayoutEffect(() => {
        messagesBySessionIdRef.current = messagesBySessionId;
        agentInteractionsBySessionIdRef.current = agentInteractionsBySessionId;
        agentCustomMessagesBySessionIdRef.current = agentCustomMessagesBySessionId;
        agentInteractionEventsBySessionIdRef.current = agentInteractionEventsBySessionId;
        currentSessionIdRef.current = sessionId;
        statusRef.current = status;
        backgroundStreamingRef.current = backgroundStreaming;
        messagesRef.current = messages;
    }, [
        messagesBySessionId,
        agentInteractionsBySessionId,
        agentCustomMessagesBySessionId,
        agentInteractionEventsBySessionId,
        sessionId,
        status,
        backgroundStreaming,
        messages,
    ]);
    const { visibleMessages, previewSteeredUserTurn } = useOptimisticSteeredTurn(messages, sessionId, isSessionIdle, buildClientUserMessage, messagesRef);
    const refs = {
        currentSessionIdRef,
        statusRef,
        backgroundStreamingRef,
        foregroundStreamActiveRef,
        foregroundSessionIdRef,
        terminalRunErrorRef,
        backgroundReconnectSessionIdRef,
        deferredRefreshSessionIdRef,
        deferredSnapshotRefreshCountRef,
        pendingRunWaiterRef,
        messagesBySessionIdRef,
    };
    const runControls = createAgentRunControls({
        sessionId,
        model,
        refs,
        setMessagesBySessionId,
        setRunRenderMessages,
        setBackgroundStreaming,
        setError,
        setStatus,
        setCompactionStatus,
        addOptimisticUserMessage,
        upsertSession,
    });
    useLayoutEffect(() => {
        agentRunActionsRef.current = runControls.runActions;
    }, [runControls.runActions]);
    const [hydrationContext] = useState(() => ({
        currentSessionIdRef,
        foregroundStreamActiveRef,
        foregroundSessionIdRef,
        pendingRunWaiterRef,
        terminalRunErrorRef,
        streamSignalVersionRef,
        lastHydratedSessionIdRef,
        lastHydratedSnapshotKeyRef,
        lastHydratedOptimisticKeyRef,
        backgroundStreamingRef,
        backgroundReconnectSessionIdRef,
        messagesBySessionIdRef,
        setMessagesBySessionId,
        setRunRenderMessages,
        setBackgroundStreaming,
        setCompactionStatus,
        setStatus,
        setError,
    }));
    const [streamEventContext] = useState(() => ({
        currentSessionIdRef,
        foregroundStreamActiveRef,
        backgroundStreamingRef,
        backgroundReconnectSessionIdRef,
        streamSignalVersionRef,
        terminalRunErrorRef,
        agentInteractionsBySessionIdRef,
        agentCustomMessagesBySessionIdRef,
        agentInteractionEventsBySessionIdRef,
        messagesBySessionIdRef,
        setMessagesBySessionId,
        setRunRenderMessages,
        setError,
        setAgentInteractionsBySessionId,
        setAgentCustomMessagesBySessionId,
        setAgentInteractionEventsBySessionId,
        setStatus,
        setCompactionStatus,
        setBackgroundStreaming,
    }));
    const [runCompletionContext] = useState(() => ({
        currentSessionIdRef,
        foregroundStreamActiveRef,
        foregroundSessionIdRef,
        terminalRunErrorRef,
        backgroundStreamingRef,
        backgroundReconnectSessionIdRef,
        deferredRefreshSessionIdRef,
        deferredSnapshotRefreshCountRef,
        statusRef,
        setBackgroundStreaming,
        setCompactionStatus,
        setStatus,
        agentRunActionsRef,
    }));
    useSessionHydrationEffects({
        sessionId,
        session,
        isSessionIdle,
        optimisticUserMessages,
        hasActiveRun,
        getRunRenderSnapshot,
        removeMatchedOptimisticUserMessages,
        context: hydrationContext,
    });
    useAgentEventEffects({
        sessionId,
        streamEventContext,
        runCompletionContext,
    });
    return {
        messages: visibleMessages,
        sendMessage: async (payload) => runControls.withDeferredSnapshotRefresh(async () => {
            await runControls.sendUserPayload(payload, null);
        }),
        sendWaggleMessage: async (payload, config) => runControls.withDeferredSnapshotRefresh(async () => {
            await runControls.sendUserPayload(payload, config);
        }),
        isLoading,
        status: backgroundStreaming ? 'streaming' : status,
        stop: runControls.stop,
        steer: runControls.steer,
        error,
        withDeferredSnapshotRefresh: runControls.withDeferredSnapshotRefresh,
        previewSteeredUserTurn,
        backgroundStreaming,
        streamSignalVersion,
        compactionStatus,
        agentInteractions,
        agentCustomMessages,
        agentInteractionEvents,
        respondAgentInteraction,
    };
}
