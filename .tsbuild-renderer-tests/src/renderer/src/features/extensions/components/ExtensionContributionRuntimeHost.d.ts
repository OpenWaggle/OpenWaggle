import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions';
import type { JsonValue } from '@shared/types/json';
export declare function ExtensionContributionRuntimeHost({ entry, autoHeight, className, chrome, fill, maxAutoHeight, minAutoHeight, onSurfaceAction, surfacePayload, }: {
    readonly entry: ExtensionContributionRegistryEntry;
    readonly autoHeight?: boolean;
    readonly className?: string;
    readonly chrome?: 'bare' | 'card';
    readonly fill?: boolean;
    readonly maxAutoHeight?: number;
    readonly minAutoHeight?: number;
    readonly onSurfaceAction?: (actionId: string, payload?: JsonValue) => void;
    readonly surfacePayload?: JsonValue;
}): import("node_modules/@types/react").JSX.Element;
