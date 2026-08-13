import type { ExtensionContributionRegistryEntry, ExtensionContributionRegistryView, ExtensionContributionRuntime, ExtensionExecutionPlacement } from '@shared/types/extensions';
export interface ExtensionDialogTarget {
    readonly extensionId: string;
    readonly dialogId: string;
    readonly packagePath: string;
    readonly contentHash: string;
}
export interface ResolvedExtensionDialogContribution {
    readonly entry: ExtensionContributionRegistryEntry;
    readonly runtime: ExtensionContributionRuntime;
    readonly execution: ExtensionExecutionPlacement;
    readonly entryPath: string;
}
export type ExtensionDialogResolution = {
    readonly status: 'available';
    readonly contribution: ResolvedExtensionDialogContribution;
} | {
    readonly status: 'not-found';
    readonly title: string;
    readonly message: string;
} | {
    readonly status: 'blocked';
    readonly title: string;
    readonly message: string;
} | {
    readonly status: 'invalid';
    readonly title: string;
    readonly message: string;
};
export declare function resolveExtensionDialogContribution({ registry, target, requestedProjectPaths, }: {
    readonly registry: ExtensionContributionRegistryView;
    readonly target: ExtensionDialogTarget;
    readonly requestedProjectPaths: readonly string[];
}): ExtensionDialogResolution;
