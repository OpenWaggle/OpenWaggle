import type { SkillDiscoveryItem } from '@shared/types/standards';
import type { WagglePreset } from '@shared/types/waggle';
import type { CommandPaletteActionHandlers, CommandPaletteItem } from '../model/command-palette-item';
import { openFeedbackModal } from './command-palette-actions';
export declare function createBaseCommands(actions: CommandPaletteActionHandlers): (CommandPaletteItem | {
    id: string;
    label: string;
    description: string;
    icon: import("node_modules/@types/react").JSX.Element;
    action: () => void;
} | {
    id: string;
    label: string;
    icon: import("node_modules/@types/react").JSX.Element;
    action: typeof openFeedbackModal;
    description?: undefined;
})[];
export declare function filterBaseCommands(commands: readonly CommandPaletteItem[], lowerQuery: string): readonly CommandPaletteItem[];
export declare function createSkillItems(slashSkills: readonly SkillDiscoveryItem[], lowerQuery: string, selectSkill: CommandPaletteActionHandlers['selectSkill']): CommandPaletteItem[];
export declare function createPresetItems(presets: readonly WagglePreset[], lowerQuery: string, selectPreset: CommandPaletteActionHandlers['selectPreset']): CommandPaletteItem[];
export declare function createConfigureWaggleItem(lowerQuery: string, configureWaggle: () => void): {
    id: string;
    label: string;
    description: string;
    icon: import("node_modules/@types/react").JSX.Element;
    section: string;
    action: () => void;
}[];
