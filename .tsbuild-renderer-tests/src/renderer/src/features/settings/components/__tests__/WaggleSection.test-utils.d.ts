import { WagglePresetId } from '@shared/types/brand';
import type { ProviderInfo } from '@shared/types/llm';
import type { WagglePreset } from '@shared/types/waggle';
export declare const PROJECT_PATH = "/tmp/openwaggle-project";
export declare const PROVIDER_MODELS: ProviderInfo[];
export declare function createPreset(overrides?: Partial<WagglePreset>): {
    id: WagglePresetId;
    name: string;
    description: string;
    config: import("@shared/types/waggle").WaggleConfig;
    isBuiltIn: boolean;
    createdAt: number;
    updatedAt: number;
};
