import type { ExtensionContributionRegistryView } from '@shared/types/extensions';
import type { ReactNode } from 'react';
import type { ExtensionAgentLoopSurfaceInput, ExtensionCustomMessageView, ExtensionInteractionActionView, ExtensionInteractionView, ExtensionStatusView, ExtensionToolResultView } from '../lib/extension-agent-loop-surface-model';
import { CUSTOM_INTERACTION_RESPONSE_ACTION_ID, CUSTOM_INTERACTION_UNAVAILABLE_ACTION_ID } from '../lib/extension-agent-loop-surface-model';
export type { ExtensionAgentLoopSurfaceInput, ExtensionCustomMessageView, ExtensionInteractionActionView, ExtensionInteractionView, ExtensionStatusView, ExtensionToolResultView, };
export { CUSTOM_INTERACTION_RESPONSE_ACTION_ID, CUSTOM_INTERACTION_UNAVAILABLE_ACTION_ID };
export declare function ExtensionAgentLoopSurface({ input, registry, projectPaths, fallback, }: {
    readonly input: ExtensionAgentLoopSurfaceInput;
    readonly registry: ExtensionContributionRegistryView | null;
    readonly projectPaths: readonly string[];
    readonly fallback?: ReactNode | null;
}): string | number | bigint | boolean | Iterable<ReactNode> | Promise<string | number | bigint | boolean | import("node_modules/@types/react").ReactPortal | import("node_modules/@types/react").ReactElement<unknown, string | import("node_modules/@types/react").JSXElementConstructor<any>> | Iterable<ReactNode> | null | undefined> | import("node_modules/@types/react").JSX.Element | null;
