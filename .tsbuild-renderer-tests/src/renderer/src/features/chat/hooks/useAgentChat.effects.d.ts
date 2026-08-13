import type { SessionId } from '@shared/types/brand';
import type { UIMessage } from '@shared/types/chat-ui';
import type { SessionDetail } from '@shared/types/session';
import type { AgentRunActions, AgentStreamEventContext, MutableValueRef, SessionHydrationContext } from './useAgentChat.types';
interface UseSessionHydrationEffectsParams {
    readonly sessionId: SessionId | null;
    readonly session: SessionDetail | null;
    readonly isSessionIdle: boolean;
    readonly optimisticUserMessages: readonly UIMessage[];
    readonly hasActiveRun: (sessionId: SessionId) => boolean;
    readonly getRunRenderSnapshot: (sessionId: SessionId) => {
        readonly messages: readonly UIMessage[];
    } | null;
    readonly removeMatchedOptimisticUserMessages: (sessionId: SessionId, persistedMessages: readonly UIMessage[]) => void;
    readonly context: SessionHydrationContext;
}
interface UseAgentEventEffectsParams {
    readonly sessionId: SessionId | null;
    readonly streamEventContext: Omit<AgentStreamEventContext, 'subscribedSessionId'>;
    readonly runCompletionContext: RunCompletionEffectContext;
}
interface RunCompletionContext {
    readonly subscribedSessionId: SessionId;
    readonly currentSessionIdRef: MutableValueRef<SessionId | null>;
    readonly foregroundStreamActiveRef: MutableValueRef<boolean>;
    readonly foregroundSessionIdRef: MutableValueRef<SessionId | null>;
    readonly terminalRunErrorRef: MutableValueRef<Error | undefined>;
    readonly backgroundStreamingRef: MutableValueRef<boolean>;
    readonly backgroundReconnectSessionIdRef: MutableValueRef<SessionId | null>;
    readonly deferredRefreshSessionIdRef: MutableValueRef<SessionId | null>;
    readonly deferredSnapshotRefreshCountRef: MutableValueRef<number>;
    readonly statusRef: MutableValueRef<string>;
    readonly setBackgroundStreaming: (backgroundStreaming: boolean) => void;
    readonly setCompactionStatus: (status: null) => void;
    readonly setStatus: (status: 'ready') => void;
    readonly agentRunActionsRef: MutableValueRef<AgentRunActions | null>;
}
export type RunCompletionEffectContext = Omit<RunCompletionContext, 'subscribedSessionId'>;
export declare function useSessionHydrationEffects(params: UseSessionHydrationEffectsParams): void;
export declare function useAgentEventEffects(params: UseAgentEventEffectsParams): void;
export {};
