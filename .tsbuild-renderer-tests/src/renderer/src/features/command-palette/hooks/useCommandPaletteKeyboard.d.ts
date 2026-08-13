import type { KeyboardEvent, RefObject } from 'react';
import type { CommandPaletteItem } from '../model';
interface UseCommandPaletteKeyboardInput {
    readonly items: readonly CommandPaletteItem[];
    readonly highlightIndex: number;
    readonly setHighlightIndex: (updater: (currentIndex: number) => number) => void;
    readonly listRef: RefObject<HTMLDivElement | null>;
}
export declare function useCommandPaletteKeyboard({ items, highlightIndex, setHighlightIndex, listRef, }: UseCommandPaletteKeyboardInput): (event: KeyboardEvent) => void;
export {};
