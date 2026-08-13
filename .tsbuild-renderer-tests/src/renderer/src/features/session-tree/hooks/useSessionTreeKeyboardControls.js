import { useHotkey } from '@tanstack/react-hotkeys';
import { useEscapeHotkey } from '@/shared/hooks/useEscapeHotkey';
import { findFirstVisibleChildIndex, findVisibleParentIndex, moveSessionTreeFocus, } from '../lib/session-tree-visibility';
function isExpandedNode(node, expandedNodeIds) {
    return expandedNodeIds.some((expandedNodeId) => String(expandedNodeId) === String(node.id));
}
export function useSessionTreeKeyboardControls(input) {
    const enabled = input.visibleRows.length > 0;
    function moveFocus(direction) {
        input.onFocusIndex(moveSessionTreeFocus({
            currentIndex: input.focusIndex,
            visibleCount: input.visibleRows.length,
            direction,
        }));
    }
    function selectFocusedNode() {
        const focusedRow = input.visibleRows[input.clampedFocusIndex];
        if (focusedRow) {
            input.onSelectNode(focusedRow.node);
        }
    }
    function expandFocusedNode() {
        const focusedRow = input.visibleRows[input.clampedFocusIndex];
        if (!focusedRow) {
            return;
        }
        if (isExpandedNode(focusedRow.node, input.rowExpandedNodeIds)) {
            input.onFocusIndex(findFirstVisibleChildIndex(input.visibleRows, input.clampedFocusIndex));
            return;
        }
        if (focusedRow.hasExpandableChildren) {
            input.onToggleNodeExpanded(focusedRow);
        }
    }
    function collapseFocusedNode() {
        const focusedRow = input.visibleRows[input.clampedFocusIndex];
        if (!focusedRow) {
            return;
        }
        if (isExpandedNode(focusedRow.node, input.rowExpandedNodeIds)) {
            input.onToggleNodeExpanded(focusedRow);
            return;
        }
        input.onFocusIndex(findVisibleParentIndex(input.visibleRows, input.clampedFocusIndex));
    }
    useEscapeHotkey(input.onClose);
    useHotkey('ArrowDown', () => moveFocus('next'), { enabled, preventDefault: true });
    useHotkey('ArrowUp', () => moveFocus('previous'), { enabled, preventDefault: true });
    useHotkey('Enter', selectFocusedNode, {
        enabled,
        preventDefault: true,
        conflictBehavior: 'allow',
    });
    useHotkey('ArrowRight', expandFocusedNode, { enabled, preventDefault: true });
    useHotkey('ArrowLeft', collapseFocusedNode, { enabled, preventDefault: true });
}
