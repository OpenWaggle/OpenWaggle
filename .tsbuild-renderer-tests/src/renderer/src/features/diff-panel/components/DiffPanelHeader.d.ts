import type { TurnCheckpointSummary } from '@shared/types/turn-diff';
import type { DiffScopeSelection } from '@/features/diff-panel/state/diff-scope-store';
import type { BaseRefChoice } from '../lib/base-ref-choices';
interface DiffPanelHeaderProps {
    readonly selection: DiffScopeSelection;
    readonly baseRef: string | null;
    readonly baseRefChoices: readonly BaseRefChoice[];
    readonly turns: readonly TurnCheckpointSummary[];
    readonly onSelectScope: (scope: 'branch' | 'unstaged' | 'turn') => void;
    readonly onChangeBaseRef: (baseRef: string) => void;
    readonly onSelectTurn: (turnId: string) => void;
}
/** Scope tabs plus the diff view controls. */
export declare function DiffPanelHeader({ selection, baseRef, baseRefChoices, turns, onSelectScope, onChangeBaseRef, onSelectTurn, }: DiffPanelHeaderProps): import("node_modules/@types/react").JSX.Element;
export {};
