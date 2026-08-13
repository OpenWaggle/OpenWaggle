import type { KeyboardEventHandler, RefObject } from 'react';
interface CommandPaletteSearchProps {
    readonly inputRef: RefObject<HTMLInputElement | null>;
    readonly query: string;
    readonly onKeyDown: KeyboardEventHandler<HTMLInputElement>;
    readonly onQueryChange: (query: string) => void;
}
export declare function CommandPaletteSearch({ inputRef, query, onKeyDown, onQueryChange, }: CommandPaletteSearchProps): import("node_modules/@types/react").JSX.Element;
export {};
