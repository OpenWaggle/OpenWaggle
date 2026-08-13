import type { AgentSendPayload } from '@shared/types/agent';
import { MessageId, SessionId, ToolCallId } from '@shared/types/brand';
import type { SessionDetail } from '@shared/types/session';
declare const apiMock: {
    onAgentEvent: import("vitest").Mock<(handler: (payload: unknown) => void) => () => void>;
    onRunCompleted: import("vitest").Mock<(handler: (payload: unknown) => void) => () => void>;
    getBackgroundRun: import("vitest").Mock<() => Promise<null>>;
    getSessionDetail: import("vitest").Mock<() => Promise<null>>;
    sendMessage: import("vitest").Mock<() => Promise<undefined>>;
    sendWaggleMessage: import("vitest").Mock<() => Promise<undefined>>;
    cancelAgent: import("vitest").Mock<() => Promise<undefined>>;
    steerAgent: import("vitest").Mock<() => Promise<{
        preserved: boolean;
    }>>;
    respondAgentInteraction: import("vitest").Mock<() => Promise<{
        ok: boolean;
        interactionId: string;
        status: string;
    }>>;
}, getRunRenderSnapshotMock: import("vitest").Mock<(sessionId: string) => {
    readonly messages: readonly unknown[];
    updatedAt: number;
} | null>, hasActiveRunMock: import("vitest").Mock<() => boolean>, runRenderSnapshots: Map<string, {
    readonly messages: readonly unknown[];
    updatedAt: number;
}>, setRunRenderMessagesMock: import("vitest").Mock<(sessionId: string, messages: readonly unknown[]) => void>;
declare const useAgentChat: typeof import("../useAgentChat").useAgentChat;
declare function emitAgentEvent(payload: unknown): void;
declare function emitRunCompleted(payload: unknown): void;
declare function createSession(): {
    id: SessionId;
    title: string;
    projectPath: string;
    createdAt: number;
    updatedAt: number;
    messages: {
        id: MessageId;
        role: string;
        createdAt: number;
        parts: {
            type: string;
            toolCall: {
                id: ToolCallId;
                name: string;
                args: {
                    path: string;
                };
                state: string;
            };
        }[];
    }[];
};
declare function createSessionWithMessages(updatedAt: number, messages: SessionDetail['messages']): {
    id: SessionId;
    title: string;
    projectPath: string;
    createdAt: number;
    updatedAt: number;
    messages: import("@shared/types/agent").Message[];
};
declare function createSessionWithId(id: SessionId): {
    id: SessionId;
    title: string;
    projectPath: string;
    createdAt: number;
    updatedAt: number;
    messages: never[];
};
declare function createSessionWithIdAndMessages(id: SessionId, updatedAt: number, messages: SessionDetail['messages']): {
    id: SessionId;
    title: string;
    projectPath: string;
    createdAt: number;
    updatedAt: number;
    messages: import("@shared/types/agent").Message[];
};
declare const SEND_PAYLOAD: AgentSendPayload;
declare function createDeferred<T>(): {
    promise: Promise<T>;
    resolve: (_value: T) => void;
};
export declare function installUseAgentChatTestLifecycle(): void;
export { apiMock, createDeferred, createSession, createSessionWithId, createSessionWithIdAndMessages, createSessionWithMessages, emitAgentEvent, emitRunCompleted, getRunRenderSnapshotMock, hasActiveRunMock, runRenderSnapshots, SEND_PAYLOAD, setRunRenderMessagesMock, useAgentChat, };
