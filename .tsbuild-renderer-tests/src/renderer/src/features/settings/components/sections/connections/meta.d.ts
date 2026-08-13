import type { Provider } from '@shared/types/settings';
import { OpenAIIcon } from '@/features/providers/components';
type ProviderIcon = typeof OpenAIIcon;
export interface ProviderMeta {
    readonly icon: ProviderIcon;
    readonly color: string;
}
export declare const PROVIDER_META: Partial<Record<Provider, ProviderMeta>>;
export declare function getProviderMeta(provider: Provider): ProviderMeta;
export {};
