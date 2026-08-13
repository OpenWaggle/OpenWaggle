import type { WagglePreset } from '@shared/types/waggle';
import { type WaggleFormAction, type WaggleFormState } from './waggle-form-state';
export type { WaggleFormAction } from './waggle-form-state';
export interface WaggleFormHook {
    readonly formState: WaggleFormState;
    readonly dispatchForm: React.Dispatch<WaggleFormAction>;
    readonly presets: readonly WagglePreset[];
    readonly activePresetId: string | null;
    readonly isModified: boolean;
    readonly displayedError: string | null;
    readonly loadPreset: (preset: WagglePreset) => void;
    readonly handleSaveEdits: () => Promise<void>;
    readonly handleNewCustom: () => Promise<void>;
    readonly handleDeletePreset: (id: string) => Promise<void>;
}
export declare function useWaggleForm(): WaggleFormHook;
