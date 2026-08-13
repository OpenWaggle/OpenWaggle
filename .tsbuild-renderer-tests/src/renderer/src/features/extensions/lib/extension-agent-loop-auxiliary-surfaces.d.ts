import type { ExtensionContributionRegistryView } from '@shared/types/extensions';
import type { JsonObject } from '@shared/types/json';
import { type ResolvedExtensionAgentLoopContribution } from './extension-agent-loop-resolution';
import type { ExtensionAgentLoopSurfaceInput, ExtensionInteractionView } from './extension-agent-loop-surface-model';
export type ExtensionAgentLoopAuxiliaryPlacement = 'dialog' | 'side-panel' | 'status-widget';
export interface ExtensionAgentLoopAuxiliaryContribution {
    readonly placement: ExtensionAgentLoopAuxiliaryPlacement;
    readonly contribution: ResolvedExtensionAgentLoopContribution;
    readonly surfacePayload: JsonObject;
}
export declare function agentLoopInputKey(input: ExtensionAgentLoopSurfaceInput): `tool:${string}` | `custom-message:${string}` | `interaction:${string}` | `transcript:${string}:${string}` | `status:${string}`;
export declare function agentLoopAuxiliarySurfacePayload(input: ExtensionAgentLoopSurfaceInput, placement: ExtensionAgentLoopAuxiliaryPlacement): JsonObject;
export declare function resolveExtensionAgentLoopAuxiliaryContributions({ input, registry, projectPaths, placement, }: {
    readonly input: ExtensionAgentLoopSurfaceInput;
    readonly registry: ExtensionContributionRegistryView | null;
    readonly projectPaths: readonly string[];
    readonly placement: ExtensionAgentLoopAuxiliaryPlacement;
}): readonly ExtensionAgentLoopAuxiliaryContribution[];
export declare function interactionSurfaceInput(interaction: ExtensionInteractionView): Extract<ExtensionAgentLoopSurfaceInput, {
    readonly surface: 'interaction';
}>;
