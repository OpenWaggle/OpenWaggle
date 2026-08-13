import type { ExtensionContributionFamily, ExtensionContributionRegistryEntry, ExtensionContributionRegistryView, ExtensionContributionRuntime, ExtensionExecutionPlacement } from '@shared/types/extensions';
export type ExtensionAgentLoopSurfaceKind = 'tool' | 'custom-message' | 'interaction' | 'status' | 'transcript';
export interface ExtensionAgentLoopTarget {
    readonly surface: ExtensionAgentLoopSurfaceKind;
    readonly extensionId?: string;
    readonly contributionId?: string;
    readonly toolName?: string;
    readonly customMessageName?: string;
    readonly interactionKind?: string;
}
export interface ResolvedExtensionAgentLoopContribution {
    readonly entry: ExtensionContributionRegistryEntry;
    readonly runtime: ExtensionContributionRuntime;
    readonly execution: ExtensionExecutionPlacement;
    readonly entryPath: string;
}
export type ExtensionAgentLoopResolution = {
    readonly status: 'available';
    readonly contribution: ResolvedExtensionAgentLoopContribution;
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
export declare function extensionAgentLoopEntryMatchesTarget(entry: ExtensionContributionRegistryEntry, target: ExtensionAgentLoopTarget): boolean;
export declare function resolveExtensionAgentLoopContribution({ registry, target, requestedProjectPaths, }: {
    readonly registry: ExtensionContributionRegistryView;
    readonly target: ExtensionAgentLoopTarget;
    readonly requestedProjectPaths: readonly string[];
}): ExtensionAgentLoopResolution;
export declare function resolveExtensionAgentLoopContributionEntries({ registry, target, requestedProjectPaths, family, }: {
    readonly registry: ExtensionContributionRegistryView;
    readonly target: ExtensionAgentLoopTarget;
    readonly requestedProjectPaths: readonly string[];
    readonly family: ExtensionContributionFamily;
}): readonly ResolvedExtensionAgentLoopContribution[];
