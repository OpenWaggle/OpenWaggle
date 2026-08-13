import type { SessionId } from '@shared/types/brand';
import type { UIMessage } from '@shared/types/chat-ui';
import type { SessionDetail } from '@shared/types/session';
import type { MutableValueRef, SetMessagesBySessionId, SetRunRenderMessages, UpdateMessagesOptions } from './useAgentChat.types';
export declare const EMPTY_UI_MESSAGES: UIMessage[];
export declare function createPendingRunWaiter(): {
    promise: Promise<void>;
    waiter: {
        resolve: () => void;
        reject: (_error: Error) => void;
    };
};
export declare function buildSessionSnapshotKey(session: SessionDetail): string;
export declare function buildOptimisticMessagesKey(messages: readonly UIMessage[]): string;
export declare function mergeSessionAndOptimisticMessages(session: SessionDetail, optimisticUserMessages: readonly UIMessage[]): UIMessage[];
export declare function getMessagesForSession(messagesBySessionIdRef: MutableValueRef<Map<SessionId, UIMessage[]>>, targetSessionId: SessionId): UIMessage[];
export declare function setMessagesForSession(messagesBySessionIdRef: MutableValueRef<Map<SessionId, UIMessage[]>>, setMessagesBySessionId: SetMessagesBySessionId, setRunRenderMessages: SetRunRenderMessages, targetSessionId: SessionId, nextMessages: UIMessage[], options?: UpdateMessagesOptions): void;
export declare function updateMessagesForSession(messagesBySessionIdRef: MutableValueRef<Map<SessionId, UIMessage[]>>, setMessagesBySessionId: SetMessagesBySessionId, setRunRenderMessages: SetRunRenderMessages, targetSessionId: SessionId, update: (currentMessages: UIMessage[]) => UIMessage[], options?: UpdateMessagesOptions): void;
