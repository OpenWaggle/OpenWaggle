import { SupportedModelId } from '@shared/types/brand';
import type { ProviderInfo } from '@shared/types/llm';
import { type Provider, type Settings } from '@shared/types/settings';
/**
 * Build a set of canonical "provider/modelId" refs from the current Pi model catalog.
 * Used to validate enabledModels entries against what actually exists.
 */
/** @internal Exported for testing */
export declare function buildModelCatalogSet(providerModels: readonly ProviderInfo[]): Set<string>;
/**
 * Remove enabledModels entries that reference models no longer in the provider
 * catalog (stale version suffixes, removed models, or providerless IDs).
 */
/** @internal Exported for testing */
export declare function pruneStaleEnabledModels(enabledModels: readonly string[], catalog: ReadonlySet<string>): SupportedModelId[] | null;
interface ProviderState {
    baseProviderModels: ProviderInfo[];
    providerModels: ProviderInfo[];
    isLoading: boolean;
    testingProviders: Partial<Record<Provider, boolean>>;
    testResults: Partial<Record<Provider, {
        success: boolean;
        error?: string;
    } | null>>;
    loadError: string | null;
    loadProviderModels: (settingsSnapshot?: Settings) => Promise<Settings | null>;
    updateApiKey: (provider: Provider, apiKey: string) => Promise<void>;
    testApiKey: (provider: Provider, apiKey: string) => Promise<boolean>;
    clearTestResult: (provider: Provider) => void;
}
export declare const useProviderStore: import("node_modules/zustand/esm/react.mjs").UseBoundStore<import("node_modules/zustand/esm/vanilla.mjs").StoreApi<ProviderState>>;
export {};
