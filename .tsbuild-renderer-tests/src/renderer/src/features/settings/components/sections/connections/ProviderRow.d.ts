import type { ProviderInfo } from '@shared/types/llm';
interface ProviderRowProps {
    providerInfo: ProviderInfo;
    isLast: boolean;
    autoEdit?: boolean;
    onEditingChange?: (editing: boolean) => void;
}
export declare function ProviderRow({ providerInfo, isLast, autoEdit, onEditingChange }: ProviderRowProps): import("node_modules/@types/react").JSX.Element;
export {};
