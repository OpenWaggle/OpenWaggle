import type { SkillDiscoveryItem } from '@shared/types/standards';
import type { WaggleConfig } from '@shared/types/waggle';
interface ChatComposerCommandPaletteProps {
    readonly open: boolean;
    readonly slashSkills: readonly SkillDiscoveryItem[];
    readonly onSelectSkill: (skillId: string, skillName?: string) => void;
    readonly onStartWaggle: (config: WaggleConfig) => void;
    readonly onOpenSessionTree?: () => void;
    readonly onForkToNewSession: () => void;
    readonly onCloneToNewSession: () => void;
}
/** Command palette overlay slot above the composer (extracted to keep ChatComposerStack small). */
export declare function ChatComposerCommandPalette(props: ChatComposerCommandPaletteProps): import("node_modules/@types/react").JSX.Element | null;
export {};
