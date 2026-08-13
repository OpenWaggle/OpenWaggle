import type { ExtensionApplyPackageRemoveInput, ExtensionManagerView, ExtensionPackageSummary } from '@shared/types/extensions';
interface RunApprovedExtensionRemoveWorkflowInput {
    readonly extensionPackage: ExtensionPackageSummary;
    readonly projectPaths: readonly string[];
    readonly resetMutations: () => void;
    readonly applyRemove: (input: ExtensionApplyPackageRemoveInput) => Promise<ExtensionManagerView>;
    readonly refreshProviderModels: () => Promise<void>;
    readonly setActionError: (message: string | null) => void;
}
export declare function runApprovedExtensionRemoveWorkflow(input: RunApprovedExtensionRemoveWorkflowInput): Promise<void>;
export {};
