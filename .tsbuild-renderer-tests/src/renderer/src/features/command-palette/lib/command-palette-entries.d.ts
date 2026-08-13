import type { CommandPaletteItem } from '../model';
type CommandPaletteEntry = {
    readonly type: 'section';
    readonly key: string;
    readonly label: string;
} | {
    readonly type: 'separator';
    readonly key: string;
} | {
    readonly type: 'item';
    readonly key: string;
    readonly item: CommandPaletteItem;
    readonly index: number;
};
export declare function buildCommandPaletteEntries(items: readonly CommandPaletteItem[]): CommandPaletteEntry[];
export {};
