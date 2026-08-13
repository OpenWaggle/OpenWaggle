import { SupportedModelId } from '@shared/types/brand';
import type { ProviderInfo } from '@shared/types/llm';
import type { Settings } from '@shared/types/settings';
interface ModelSelectorProps {
    value: SupportedModelId;
    onChange: (model: SupportedModelId) => void;
    settings: Settings;
    providerModels: ProviderInfo[];
    className?: string;
}
export declare function ModelSelector({ value, onChange, settings, providerModels, className, }: ModelSelectorProps): import("node_modules/@types/react").JSX.Element;
export {};
