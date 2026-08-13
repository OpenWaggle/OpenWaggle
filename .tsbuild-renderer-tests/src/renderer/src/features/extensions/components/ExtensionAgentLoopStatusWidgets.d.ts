import type { ExtensionContributionRegistryView } from '@shared/types/extensions';
import type { JsonValue } from '@shared/types/json';
import type { ExtensionAgentLoopSurfaceInput } from '../lib/extension-agent-loop-surface-model';
export declare function ExtensionAgentLoopStatusWidgets({ input, registry, projectPaths, onSurfaceAction, }: {
    readonly input: ExtensionAgentLoopSurfaceInput;
    readonly registry: ExtensionContributionRegistryView | null;
    readonly projectPaths: readonly string[];
    readonly onSurfaceAction?: (actionId: string, payload?: JsonValue) => void;
}): import("node_modules/@types/react").JSX.Element | null;
