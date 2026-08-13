import type { ExtensionContributionRegistryEntry, ExtensionContributionRegistryView, ExtensionContributionRuntime, ExtensionExecutionPlacement } from '@shared/types/extensions';
export interface ExtensionSidePanelTarget {
    readonly extensionId: string;
    readonly sidePanelId: string;
    readonly packagePath?: string;
    readonly contentHash?: string;
}
export interface ResolvedExtensionSidePanelContribution {
    readonly entry: ExtensionContributionRegistryEntry;
    readonly runtime: ExtensionContributionRuntime;
    readonly execution: ExtensionExecutionPlacement;
    readonly entryPath: string;
}
export type ExtensionSidePanelResolution = {
    readonly status: 'available';
    readonly contribution: ResolvedExtensionSidePanelContribution;
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
export declare function resolveExtensionSidePanelContribution({ registry, target, requestedProjectPaths, }: {
    readonly registry: ExtensionContributionRegistryView;
    readonly target: ExtensionSidePanelTarget;
    readonly requestedProjectPaths: readonly string[];
}): ExtensionSidePanelResolution;
