import type { GitBranchInfo } from '@shared/types/git';
/**
 * Base-ref choices for the Branch-diff base-ref combobox (WS6b).
 *
 * Local branches are paired with their matching remote (preferring origin) so the
 * list reads as one entry per ref rather than duplicating every branch; remotes
 * with no local counterpart are surfaced on their own so they remain selectable.
 */
export interface BaseRefChoice {
    readonly id: string;
    readonly label: string;
}
export declare function buildBaseRefChoices(branches: readonly GitBranchInfo[]): readonly BaseRefChoice[];
