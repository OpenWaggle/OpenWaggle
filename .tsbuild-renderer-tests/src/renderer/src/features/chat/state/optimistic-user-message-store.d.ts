import type { SessionId } from '@shared/types/brand';
import type { UIMessage } from '@shared/types/chat-ui';
interface OptimisticUserMessageState {
    readonly messagesBySessionId: Map<SessionId, readonly UIMessage[]>;
    readonly add: (sessionId: SessionId, message: UIMessage) => void;
    readonly removeMatched: (sessionId: SessionId, persistedMessages: readonly UIMessage[]) => void;
    readonly clear: (sessionId: SessionId) => void;
}
export declare function selectOptimisticUserMessages(sessionId: SessionId | null): (_state: OptimisticUserMessageState) => readonly UIMessage[];
export declare const useOptimisticUserMessageStore: import("node_modules/zustand/esm/react.mjs").UseBoundStore<import("node_modules/zustand/esm/vanilla.mjs").StoreApi<OptimisticUserMessageState>>;
export {};
