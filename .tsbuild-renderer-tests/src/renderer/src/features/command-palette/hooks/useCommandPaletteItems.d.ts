import type { SkillDiscoveryItem } from '@shared/types/standards';
import type { CommandPaletteCallbacks } from '../model';
interface UseCommandPaletteItemsInput extends CommandPaletteCallbacks {
    readonly query: string;
    readonly slashSkills: readonly SkillDiscoveryItem[];
}
export declare function useCommandPaletteItems({ query, slashSkills, onSelectSkill, onStartWaggle, onOpenSessionTree, onForkToNewSession, onCloneToNewSession, }: UseCommandPaletteItemsInput): (import("../model").CommandPaletteItem | {
    id: string;
    label: string;
    description: string;
    icon: import("node_modules/@types/react").JSX.Element;
    section: string;
    action: () => void;
})[];
export {};
