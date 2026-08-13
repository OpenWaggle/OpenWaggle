import { useMemo } from 'react';
import { useDiffScopeStore, useSessionTurns } from '@/features/diff-panel';
/**
 * Transcript turn-reveal (WS6b): maps assistant messages to their Turn
 * checkpoint via the checkpoint anchor node id, and reveals a turn's diff by
 * selecting it and opening the diff panel.
 */
export function useTurnReveal(activeSessionId, navigate, refreshToken = 0) {
    const turns = useSessionTurns(activeSessionId, refreshToken);
    const turnAnchorMessageIds = useMemo(() => new Set(turns.flatMap((turn) => (turn.anchorNodeId ? [turn.anchorNodeId] : []))), [turns]);
    function handleViewTurnDiff(messageId) {
        if (!activeSessionId)
            return;
        const turn = turns.find((candidate) => candidate.anchorNodeId === messageId);
        if (!turn)
            return;
        useDiffScopeStore.getState().selectTurn(String(activeSessionId), turn.turnId);
        void navigate({
            to: '/sessions/$sessionId',
            params: { sessionId: String(activeSessionId) },
            search: (previous) => ({ ...previous, panel: 'diff' }),
        });
    }
    return { turnAnchorMessageIds, handleViewTurnDiff };
}
