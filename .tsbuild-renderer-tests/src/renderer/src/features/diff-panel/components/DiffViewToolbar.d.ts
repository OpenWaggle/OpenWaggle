import type { DiffView } from '@shared/types/settings';
import type { DiffViewOptions } from './DiffCodeView';
interface DiffViewToolbarProps {
    readonly viewOptions: DiffViewOptions;
    readonly onSetDiffView: (view: DiffView) => void;
    readonly onToggleWrapLines: () => void;
}
/**
 * View controls for the diff. These write through to the persisted setting rather
 * than to local state, so the panel and Settings > Appearance always agree.
 */
export declare function DiffViewToolbar({ viewOptions, onSetDiffView, onToggleWrapLines, }: DiffViewToolbarProps): import("node_modules/@types/react").JSX.Element;
export {};
