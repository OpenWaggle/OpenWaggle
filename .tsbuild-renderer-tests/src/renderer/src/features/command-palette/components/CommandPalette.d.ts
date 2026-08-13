import type { SkillDiscoveryItem } from '@shared/types/standards';
import type { WaggleConfig } from '@shared/types/waggle';
interface CommandPaletteProps {
    readonly slashSkills: readonly SkillDiscoveryItem[];
    readonly onSelectSkill: (skillId: string, skillName?: string) => void;
    readonly onStartWaggle: (config: WaggleConfig) => void;
    readonly onOpenSessionTree?: () => void;
    readonly onForkToNewSession?: () => void;
    readonly onCloneToNewSession?: () => void;
}
export declare function CommandPalette({ slashSkills, onSelectSkill, onStartWaggle, onOpenSessionTree, onForkToNewSession, onCloneToNewSession, }: CommandPaletteProps): import("node_modules/@types/react").JSX.Element;
export {};
