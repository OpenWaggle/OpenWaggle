import type { MoveSessionTreeFocusInput, SessionTreeRow } from '../model';
export declare function findFirstVisibleChildIndex(visibleRows: readonly SessionTreeRow[], currentIndex: number): number;
export declare function findVisibleParentIndex(visibleRows: readonly SessionTreeRow[], currentIndex: number): number;
export declare function clampSessionTreeFocusIndex(currentIndex: number, visibleCount: number): number;
export declare function moveSessionTreeFocus({ currentIndex, visibleCount, direction, }: MoveSessionTreeFocusInput): number;
