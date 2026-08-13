import type { ExtensionContributionRegistryView, ExtensionLifecycleMutationTarget, ExtensionManagerView, ExtensionPackageLifecycleScope, ExtensionPackageSummary } from '@shared/types/extensions';
export interface ExtensionsSectionController {
    readonly view: ExtensionManagerView | null;
    readonly contributionRegistry: ExtensionContributionRegistryView | null;
    readonly loading: boolean;
    readonly updatingExtensionId: string | null;
    readonly error: string | null;
    readonly refresh: () => Promise<void>;
    readonly setTrusted: (extensionPackage: ExtensionPackageSummary, trusted: boolean) => Promise<void>;
    readonly setEnabled: (extensionPackage: ExtensionPackageSummary, enabled: boolean) => Promise<void>;
    readonly setProjectDisabled: (extensionPackage: ExtensionPackageSummary, projectPath: string, disabled: boolean) => Promise<void>;
    readonly acceptUpdate: (extensionPackage: ExtensionPackageSummary) => Promise<void>;
    readonly approveBuild: (extensionPackage: ExtensionPackageSummary) => Promise<void>;
    readonly reload: (extensionPackage: ExtensionPackageSummary) => Promise<void>;
    readonly remove: (extensionPackage: ExtensionPackageSummary) => Promise<void>;
}
interface MutationSnapshot {
    readonly pending: boolean;
    readonly error: Error | null;
    readonly extensionId: string | null;
}
type MutationSlot = 'trusted' | 'enabled' | 'projectDisabled' | 'update' | 'build' | 'reload' | 'remove';
export type MutationSnapshots = Readonly<Record<MutationSlot, MutationSnapshot>>;
export declare function describeExtensionControllerError(error: unknown): string;
export declare function mutationSnapshot(input: {
    readonly error: Error | null;
    readonly isPending: boolean;
    readonly variables: ExtensionLifecycleMutationTarget | undefined;
}): MutationSnapshot;
export declare function extensionMutationState(mutations: MutationSnapshots): {
    latestError: Error | null;
    pending: boolean;
    updatingId: string | null;
};
export declare function extensionControllerError(input: {
    readonly extensionsError: Error | null;
    readonly contributionsError: Error | null;
    readonly mutationLatestError: Error | null;
}): string | null;
export declare function getUpdatingExtensionId({ trustedPending, trustedExtensionId, enabledPending, enabledExtensionId, projectDisabledPending, projectDisabledExtensionId, updatePending, updateExtensionId, buildPending, buildExtensionId, reloadPending, reloadExtensionId, removePending, removeExtensionId, }: {
    readonly trustedPending: boolean;
    readonly trustedExtensionId: string | null;
    readonly enabledPending: boolean;
    readonly enabledExtensionId: string | null;
    readonly projectDisabledPending: boolean;
    readonly projectDisabledExtensionId: string | null;
    readonly updatePending: boolean;
    readonly updateExtensionId: string | null;
    readonly buildPending: boolean;
    readonly buildExtensionId: string | null;
    readonly reloadPending: boolean;
    readonly reloadExtensionId: string | null;
    readonly removePending: boolean;
    readonly removeExtensionId: string | null;
}): string | null;
export declare function hasPendingMutation({ trustedPending, enabledPending, projectDisabledPending, updatePending, buildPending, reloadPending, removePending, }: {
    readonly trustedPending: boolean;
    readonly enabledPending: boolean;
    readonly projectDisabledPending: boolean;
    readonly updatePending: boolean;
    readonly buildPending: boolean;
    readonly reloadPending: boolean;
    readonly removePending: boolean;
}): boolean;
export declare function mutationError({ trustedError, enabledError, projectDisabledError, updateError, buildError, reloadError, removeError, }: {
    readonly trustedError: Error | null;
    readonly enabledError: Error | null;
    readonly projectDisabledError: Error | null;
    readonly updateError: Error | null;
    readonly buildError: Error | null;
    readonly reloadError: Error | null;
    readonly removeError: Error | null;
}): Error | null;
export declare function controllerError({ queryError, latestMutationError, }: {
    readonly queryError: Error | null;
    readonly latestMutationError: Error | null;
}): string | null;
export declare function packageScopeToMutationScope(extensionPackage: ExtensionPackageSummary): ExtensionPackageLifecycleScope;
export declare function logMutationFailure({ action, extensionPackage, projectPath, viewProjectPaths, error, }: {
    readonly action: string;
    readonly extensionPackage: ExtensionPackageSummary;
    readonly projectPath: string | null;
    readonly viewProjectPaths: readonly string[];
    readonly error: unknown;
}): void;
export {};
