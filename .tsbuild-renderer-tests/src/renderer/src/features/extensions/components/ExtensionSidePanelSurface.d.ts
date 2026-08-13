import type { ExtensionContributionRegistryView } from '@shared/types/extensions';
import type { JsonValue } from '@shared/types/json';
import type { ExtensionSidePanelTarget } from '../lib/extension-side-panel-resolution';
export declare function ExtensionSidePanelSurfaceContent({ target, projectPaths, registry, loading, error, onRefresh, onClose, onSurfaceAction, surfacePayload, }: {
    readonly target: ExtensionSidePanelTarget;
    readonly projectPaths: readonly string[];
    readonly registry: ExtensionContributionRegistryView | null;
    readonly loading: boolean;
    readonly error: string | null;
    readonly onRefresh: () => void;
    readonly onClose: () => void;
    readonly onSurfaceAction?: (actionId: string, payload?: JsonValue) => void;
    readonly surfacePayload?: JsonValue;
}): import("node_modules/@types/react").JSX.Element;
export declare function ExtensionSidePanelSurface({ target, projectPaths, registry, loading, error, onRefresh, onClose, onSurfaceAction, surfacePayload, }: {
    readonly target: ExtensionSidePanelTarget;
    readonly projectPaths: readonly string[];
    readonly registry: ExtensionContributionRegistryView | null;
    readonly loading: boolean;
    readonly error: string | null;
    readonly onRefresh: () => void;
    readonly onClose: () => void;
    readonly onSurfaceAction?: (actionId: string, payload?: JsonValue) => void;
    readonly surfacePayload?: JsonValue;
}): import("node_modules/@types/react").JSX.Element;
