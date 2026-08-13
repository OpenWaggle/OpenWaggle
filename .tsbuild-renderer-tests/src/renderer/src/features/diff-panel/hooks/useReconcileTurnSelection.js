import { useEffect } from 'react';
import { useDiffScopeStore } from '@/features/diff-panel/state/diff-scope-store';
/**
 * Reset a stale turn selection (e.g. after the selected turn was pruned) to the
 * latest available turn. Turns are ascending, so reverse to latest-first for the
 * store's latest-first contract (review renderer-M1).
 */
export function useReconcileTurnSelection(scopeKey, turns) {
    const reconcileTurnSelection = useDiffScopeStore((s) => s.reconcileTurnSelection);
    useEffect(() => {
        if (!scopeKey)
            return;
        reconcileTurnSelection(scopeKey, turns.map((turn) => turn.turnId).reverse());
    }, [scopeKey, turns, reconcileTurnSelection]);
}
