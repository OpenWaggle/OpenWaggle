import type { TurnCheckpointSummary } from '@shared/types/turn-diff';
import type { BaseRefChoice } from '@/features/diff-panel/lib/base-ref-choices';
import type { DiffScopeSelection } from '@/features/diff-panel/state/diff-scope-store';
type ScopeKind = 'branch' | 'unstaged' | 'turn';
interface DiffScopeTabsProps {
    readonly selection: DiffScopeSelection;
    readonly baseRef: string | null;
    readonly baseRefChoices: readonly BaseRefChoice[];
    readonly turns: readonly TurnCheckpointSummary[];
    readonly onSelectScope: (scope: ScopeKind) => void;
    readonly onChangeBaseRef: (baseRef: string) => void;
    readonly onSelectTurn: (turnId: string) => void;
}
/**
 * Diff scope selector (WS6): switch between the working-tree diff, a branch diff
 * against a base ref (combobox with an "Automatic" default + branch choices),
 * and per-turn Turn diffs. The Turns tab appears only when the session has
 * captured Turn checkpoints.
 */
export declare function DiffScopeTabs({ selection, baseRef, baseRefChoices, turns, onSelectScope, onChangeBaseRef, onSelectTurn, }: DiffScopeTabsProps): import("node_modules/@types/react").JSX.Element;
export {};
