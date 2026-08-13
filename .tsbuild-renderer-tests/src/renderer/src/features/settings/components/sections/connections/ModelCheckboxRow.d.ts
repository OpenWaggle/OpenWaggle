import type { ModelDisplayInfo } from '@shared/types/llm';
import type { Provider } from '@shared/types/settings';
interface ModelCheckboxRowProps {
    readonly model: ModelDisplayInfo;
    readonly checked: boolean;
    readonly provider: Provider;
    readonly onToggle: (provider: Provider, modelRef: string, enabled: boolean) => void;
}
export declare function ModelCheckboxRow({ model, checked, provider, onToggle }: ModelCheckboxRowProps): import("node_modules/@types/react").JSX.Element;
export {};
