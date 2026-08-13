import type { CommandPaletteItem } from '../model';
interface CommandPaletteItemButtonProps {
    readonly item: CommandPaletteItem;
    readonly highlighted: boolean;
    readonly index: number;
    readonly onHighlightIndexChange: (index: number) => void;
}
export declare function CommandPaletteItemButton({ item, highlighted, index, onHighlightIndexChange, }: CommandPaletteItemButtonProps): import("node_modules/@types/react").JSX.Element;
export {};
