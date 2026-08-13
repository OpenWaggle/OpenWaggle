import type { AgentSendPayload } from '@shared/types/agent';
import type { SessionId } from '@shared/types/brand';
import type { AgentChatStatus } from './useAgentChat';
interface UseAutoSendQueueOptions {
    sessionId: SessionId | null;
    status: AgentChatStatus;
    sendMessage: (payload: AgentSendPayload) => Promise<void>;
    paused?: boolean;
    onSendFailure?: (payload: AgentSendPayload, error: unknown) => void;
}
/**
 * Watches agent status transitions and handles queued messages:
 *
 * 1. When the agent transitions from non-ready to 'ready', auto-dequeues and
 *    sends the next message as a new turn.
 *
 * When `paused` is true the hook skips firing AND preserves the previous status
 * so the non-ready → ready transition is still detected once unpaused.
 */
export declare function useAutoSendQueue({ sessionId, status, sendMessage, paused, onSendFailure, }: UseAutoSendQueueOptions): void;
export {};
