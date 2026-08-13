import type { TurnCheckpointSummary } from '@shared/types/turn-diff';
/**
 * Reset a stale turn selection (e.g. after the selected turn was pruned) to the
 * latest available turn. Turns are ascending, so reverse to latest-first for the
 * store's latest-first contract (review renderer-M1).
 */
export declare function useReconcileTurnSelection(scopeKey: string, turns: readonly TurnCheckpointSummary[]): void;
