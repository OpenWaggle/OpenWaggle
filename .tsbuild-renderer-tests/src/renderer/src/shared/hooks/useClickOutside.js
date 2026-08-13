import { useEffect } from 'react';
/**
 * Calls `onClose` when a mousedown occurs outside the referenced element.
 * No-ops when the ref is null or the element is not mounted.
 */
export function useClickOutside(ref, onClose, enabled = true) {
    useEffect(() => {
        if (!enabled)
            return;
        function onMouseDown(event) {
            if (ref.current && event.target instanceof Node && !ref.current.contains(event.target)) {
                onClose();
            }
        }
        document.addEventListener('mousedown', onMouseDown);
        return () => document.removeEventListener('mousedown', onMouseDown);
    }, [ref, onClose, enabled]);
}
