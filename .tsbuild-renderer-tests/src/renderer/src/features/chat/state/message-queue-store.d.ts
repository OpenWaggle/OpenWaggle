import type { AgentSendPayload } from '@shared/types/agent';
import type { SessionId } from '@shared/types/brand';
export interface QueuedMessage {
    readonly id: string;
    readonly payload: AgentSendPayload;
    readonly queuedAt: number;
}
interface MessageQueueState {
    queues: Map<SessionId, QueuedMessage[]>;
    enqueue: (sessionId: SessionId, payload: AgentSendPayload) => void;
    dequeue: (sessionId: SessionId) => QueuedMessage | null;
    dismiss: (sessionId: SessionId, messageId: string) => void;
    promoteToFront: (sessionId: SessionId, messageId: string) => void;
    clearQueue: (sessionId: SessionId) => void;
}
export declare function selectQueue(sessionId: SessionId | null): (_state: MessageQueueState) => readonly QueuedMessage[];
export declare const useMessageQueueStore: import("node_modules/zustand/esm/react.mjs").UseBoundStore<import("node_modules/zustand/esm/vanilla.mjs").StoreApi<MessageQueueState>>;
export {};
