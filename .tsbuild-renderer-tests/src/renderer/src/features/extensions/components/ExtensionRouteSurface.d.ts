import type { ExtensionContributionRegistryView } from '@shared/types/extensions';
export declare function ExtensionRouteSurfaceContent({ extensionId, routeId, projectPaths, registry, loading, error, onRefresh, }: {
    readonly extensionId: string;
    readonly routeId: string;
    readonly projectPaths: readonly string[];
    readonly registry: ExtensionContributionRegistryView | null;
    readonly loading: boolean;
    readonly error: string | null;
    readonly onRefresh: () => void;
}): import("node_modules/@types/react").JSX.Element;
export declare function ExtensionRouteSurface({ extensionId, routeId, }: {
    readonly extensionId: string;
    readonly routeId: string;
}): import("node_modules/@types/react").JSX.Element;
