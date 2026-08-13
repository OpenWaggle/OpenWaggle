import type { SessionId } from '@shared/types/brand';
type TurnRevealNavigate = (options: {
    to: '/sessions/$sessionId';
    params: {
        sessionId: string;
    };
    search: (previous: Record<string, unknown>) => Record<string, unknown>;
}) => Promise<void> | void;
/**
 * Transcript turn-reveal (WS6b): maps assistant messages to their Turn
 * checkpoint via the checkpoint anchor node id, and reveals a turn's diff by
 * selecting it and opening the diff panel.
 */
export declare function useTurnReveal(activeSessionId: SessionId | null, navigate: TurnRevealNavigate, refreshToken?: number): {
    turnAnchorMessageIds: Set<string>;
    handleViewTurnDiff: (messageId: string) => void;
};
export {};
