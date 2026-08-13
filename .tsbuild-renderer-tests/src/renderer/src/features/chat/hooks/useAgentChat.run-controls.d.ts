import type { AgentSendPayload } from '@shared/types/agent';
import type { SessionId } from '@shared/types/brand';
import type { UIMessage } from '@shared/types/chat-ui';
import type { SupportedModelId } from '@shared/types/llm';
import type { SessionDetail } from '@shared/types/session';
import type { WaggleConfig } from '@shared/types/waggle';
import type { AgentChatStatus, MutableValueRef, PendingRunWaiter, SetAgentChatError, SetAgentChatStatus, SetBackgroundStreaming, SetCompactionStatus, SetMessagesBySessionId, SetRunRenderMessages } from './useAgentChat.types';
interface AgentRunControlRefs {
    readonly currentSessionIdRef: MutableValueRef<SessionId | null>;
    readonly statusRef: MutableValueRef<AgentChatStatus>;
    readonly backgroundStreamingRef: MutableValueRef<boolean>;
    readonly foregroundStreamActiveRef: MutableValueRef<boolean>;
    readonly foregroundSessionIdRef: MutableValueRef<SessionId | null>;
    readonly terminalRunErrorRef: MutableValueRef<Error | undefined>;
    readonly backgroundReconnectSessionIdRef: MutableValueRef<SessionId | null>;
    readonly deferredRefreshSessionIdRef: MutableValueRef<SessionId | null>;
    readonly deferredSnapshotRefreshCountRef: MutableValueRef<number>;
    readonly pendingRunWaiterRef: MutableValueRef<PendingRunWaiter | null>;
    readonly messagesBySessionIdRef: MutableValueRef<Map<SessionId, UIMessage[]>>;
}
interface AgentRunControlParams {
    readonly sessionId: SessionId | null;
    readonly model: SupportedModelId;
    readonly refs: AgentRunControlRefs;
    readonly setMessagesBySessionId: SetMessagesBySessionId;
    readonly setRunRenderMessages: SetRunRenderMessages;
    readonly setBackgroundStreaming: SetBackgroundStreaming;
    readonly setError: SetAgentChatError;
    readonly setStatus: SetAgentChatStatus;
    readonly setCompactionStatus: SetCompactionStatus;
    readonly addOptimisticUserMessage: (sessionId: SessionId, message: UIMessage) => void;
    readonly upsertSession: (session: SessionDetail) => void;
}
export declare function createAgentRunControls(params: AgentRunControlParams): {
    runActions: {
        flushDeferredSessionSnapshot: () => void;
        settlePendingRun: (nextError?: Error) => void;
    };
    withDeferredSnapshotRefresh: <T>(operation: () => Promise<T>) => Promise<T>;
    sendUserPayload: (payload: AgentSendPayload, waggleConfig: WaggleConfig | null) => Promise<void>;
    stop: () => void;
    steer: () => Promise<void>;
};
export {};
