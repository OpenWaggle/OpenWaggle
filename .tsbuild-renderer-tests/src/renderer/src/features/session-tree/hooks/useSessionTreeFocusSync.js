import { useEffect, useRef } from 'react';
export function useSessionTreeFocusSync(input) {
    const hasFocusedTreeRowRef = useRef(false);
    useEffect(() => {
        const node = input.visibleNodes[input.clampedFocusIndex];
        if (!node) {
            return;
        }
        const activeElement = document.activeElement;
        const focusIsInTreeRows = activeElement
            ? input.treeRowsRef.current?.contains(activeElement)
            : false;
        if (hasFocusedTreeRowRef.current && !focusIsInTreeRows) {
            return;
        }
        hasFocusedTreeRowRef.current = true;
        input.rowRefs.current.get(String(node.id))?.focus();
    }, [input.visibleNodes, input.clampedFocusIndex, input.rowRefs, input.treeRowsRef]);
}
