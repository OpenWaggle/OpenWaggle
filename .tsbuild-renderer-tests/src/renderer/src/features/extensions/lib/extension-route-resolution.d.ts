import type { ExtensionContributionRegistryEntry, ExtensionContributionRegistryView, ExtensionContributionRuntime, ExtensionExecutionPlacement } from '@shared/types/extensions';
export interface ResolvedExtensionRouteContribution {
    readonly entry: ExtensionContributionRegistryEntry;
    readonly runtime: ExtensionContributionRuntime;
    readonly execution: ExtensionExecutionPlacement;
    readonly entryPath: string;
}
export type ExtensionRouteResolution = {
    readonly status: 'available';
    readonly contribution: ResolvedExtensionRouteContribution;
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
export declare function resolveExtensionRouteContribution({ registry, extensionId, routeId, requestedProjectPaths, }: {
    readonly registry: ExtensionContributionRegistryView;
    readonly extensionId: string;
    readonly routeId: string;
    readonly requestedProjectPaths: readonly string[];
}): ExtensionRouteResolution;
