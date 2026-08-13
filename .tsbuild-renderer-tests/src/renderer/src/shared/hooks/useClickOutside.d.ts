import type { RefObject } from 'react';
/**
 * Calls `onClose` when a mousedown occurs outside the referenced element.
 * No-ops when the ref is null or the element is not mounted.
 */
export declare function useClickOutside(ref: RefObject<HTMLElement | null>, onClose: () => void, enabled?: boolean): void;
