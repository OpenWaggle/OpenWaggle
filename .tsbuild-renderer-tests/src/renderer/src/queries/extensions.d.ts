import type { ExtensionApplyPackageRemoveInput, ExtensionContributionRegistryView, ExtensionManagerView, ExtensionSetEnabledInput, ExtensionSetProjectDisabledInput, ExtensionSetTrustedInput } from '@shared/types/extensions';
import { type QueryClient } from '@tanstack/react-query';
import type { OpenWaggleQueryOptions } from './query-options';
declare function extensionPackagesQueryKey(projectPaths: readonly string[]): readonly ['extensionPackages', ...string[]];
declare function extensionContributionsKey(projectPaths: readonly string[], sessionId?: string): readonly ['extensionContributions', ...string[]];
export declare function invalidateExtensionContributionsQueries(queryClient?: QueryClient): Promise<void>;
export declare function extensionPackagesQueryOptions(projectPaths: readonly string[]): OpenWaggleQueryOptions<ExtensionManagerView, Error, ExtensionManagerView, ReturnType<typeof extensionPackagesQueryKey>>;
export declare function extensionContributionsQueryOptions(projectPaths: readonly string[], options?: {
    readonly sessionId?: string | null;
}): OpenWaggleQueryOptions<ExtensionContributionRegistryView, Error, ExtensionContributionRegistryView, ReturnType<typeof extensionContributionsKey>>;
export declare function useSetExtensionTrustedMutation(projectPaths: readonly string[]): import("node_modules/@tanstack/react-query/build/modern").UseMutationResult<ExtensionManagerView, Error, ExtensionSetTrustedInput, unknown>;
export declare function useSetExtensionEnabledMutation(projectPaths: readonly string[]): import("node_modules/@tanstack/react-query/build/modern").UseMutationResult<ExtensionManagerView, Error, ExtensionSetEnabledInput, unknown>;
export declare function useSetExtensionProjectDisabledMutation(projectPaths: readonly string[]): import("node_modules/@tanstack/react-query/build/modern").UseMutationResult<ExtensionManagerView, Error, ExtensionSetProjectDisabledInput, unknown>;
export declare function useAcceptExtensionUpdateMutation(projectPaths: readonly string[]): import("node_modules/@tanstack/react-query/build/modern").UseMutationResult<ExtensionManagerView, Error, import("@shared/types/extensions").ExtensionLifecycleMutationTarget, unknown>;
export declare function useApproveExtensionBuildMutation(projectPaths: readonly string[]): import("node_modules/@tanstack/react-query/build/modern").UseMutationResult<ExtensionManagerView, Error, import("@shared/types/extensions").ExtensionLifecycleMutationTarget, unknown>;
export declare function useReloadExtensionMutation(projectPaths: readonly string[]): import("node_modules/@tanstack/react-query/build/modern").UseMutationResult<ExtensionManagerView, Error, import("@shared/types/extensions").ExtensionLifecycleMutationTarget, unknown>;
export declare function useApplyExtensionPackageRemoveMutation(projectPaths: readonly string[]): import("node_modules/@tanstack/react-query/build/modern").UseMutationResult<ExtensionManagerView, Error, ExtensionApplyPackageRemoveInput, unknown>;
export {};
