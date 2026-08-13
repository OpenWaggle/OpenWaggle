import type { RefObject } from 'react';
import type { CommandPaletteItem } from '../model';
interface CommandPaletteListProps {
    readonly items: readonly CommandPaletteItem[];
    readonly highlightIndex: number;
    readonly onHighlightIndexChange: (index: number) => void;
    readonly listRef: RefObject<HTMLDivElement | null>;
}
export declare function CommandPaletteList({ items, highlightIndex, onHighlightIndexChange, listRef, }: CommandPaletteListProps): import("node_modules/@types/react").JSX.Element;
export {};
