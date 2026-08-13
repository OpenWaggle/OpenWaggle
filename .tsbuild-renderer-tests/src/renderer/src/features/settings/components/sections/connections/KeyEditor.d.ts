import type { ProviderInfo } from '@shared/types/llm';
interface KeyEditorProps {
    providerInfo: ProviderInfo;
    onSave: (key: string) => Promise<void>;
    onClear: () => Promise<void>;
    onTest: (key: string) => Promise<boolean>;
    isTesting: boolean;
    testResult: {
        success: boolean;
        error?: string;
    } | null;
    onClose: () => void;
}
export declare function KeyEditor({ providerInfo, onSave, onClear, onTest, isTesting, testResult, onClose, }: KeyEditorProps): import("node_modules/@types/react").JSX.Element;
export {};
