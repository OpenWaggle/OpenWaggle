import type { WagglePreset } from '@shared/types/waggle';
interface WagglePresetsPanelProps {
    presets: readonly WagglePreset[];
    activePresetId: string | null;
    isModified: boolean;
    onLoadPreset: (preset: WagglePreset) => void;
    onDeletePreset: (id: string) => Promise<void>;
    onSaveEdits: () => Promise<void>;
    onNewCustom: () => Promise<void>;
}
export declare function WagglePresetsPanel({ presets, activePresetId, isModified, onLoadPreset, onDeletePreset, onSaveEdits, onNewCustom, }: WagglePresetsPanelProps): import("node_modules/@types/react").JSX.Element;
export {};
