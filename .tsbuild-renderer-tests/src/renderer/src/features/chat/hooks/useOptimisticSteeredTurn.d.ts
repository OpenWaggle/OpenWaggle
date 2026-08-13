import type { AgentSendPayload } from '@shared/types/agent';
import type { SessionId } from '@shared/types/brand';
import type { UIMessage } from '@shared/types/chat-ui';
interface OptimisticSteeredTurnReturn {
    readonly visibleMessages: UIMessage[];
    readonly previewSteeredUserTurn: (payload: AgentSendPayload) => () => void;
}
/**
 * Manages the optimistic steered user turn — an immediate preview
 * of the user's steered message before the server confirms it.
 * Auto-clears when the real message appears in the hydrated messages.
 */
export declare function useOptimisticSteeredTurn(hydratedMessages: UIMessage[], sessionId: SessionId | null, isSessionIdle: boolean, buildClientUserMessage: (payload: AgentSendPayload) => string, messagesRef: React.RefObject<UIMessage[]>): OptimisticSteeredTurnReturn;
export {};
