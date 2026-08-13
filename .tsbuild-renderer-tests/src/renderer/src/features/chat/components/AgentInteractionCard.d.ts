import type { AgentLoopInteraction, AgentLoopInteractionResponse } from '@shared/types/agent-loop-interaction';
import type { ExtensionContributionRegistryView } from '@shared/types/extensions';
type SubmitInteractionResponse = (interaction: AgentLoopInteraction, response: AgentLoopInteractionResponse) => void;
export declare function AgentInteractionCard({ interaction, busy, extensionRegistry, extensionProjectPaths, submit, }: {
    readonly interaction: AgentLoopInteraction;
    readonly busy: boolean;
    readonly extensionRegistry: ExtensionContributionRegistryView | null;
    readonly extensionProjectPaths: readonly string[];
    readonly submit: SubmitInteractionResponse;
}): import("node_modules/@types/react").JSX.Element;
export {};
