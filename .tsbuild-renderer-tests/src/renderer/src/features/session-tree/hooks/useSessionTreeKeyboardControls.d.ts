import type { SessionNode } from '@shared/types/session';
import type { SessionTreeRow } from '../model';
interface SessionTreeKeyboardControlsInput {
    readonly clampedFocusIndex: number;
    readonly focusIndex: number;
    readonly rowExpandedNodeIds: readonly SessionNode['id'][];
    readonly visibleRows: readonly SessionTreeRow[];
    readonly onClose: () => void;
    readonly onFocusIndex: (index: number) => void;
    readonly onSelectNode: (node: SessionNode) => void;
    readonly onToggleNodeExpanded: (row: SessionTreeRow) => void;
}
export declare function useSessionTreeKeyboardControls(input: SessionTreeKeyboardControlsInput): void;
export {};
