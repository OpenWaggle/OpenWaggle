import type { AgentLoopInteraction, AgentLoopInteractionResponse } from '@shared/types/agent-loop-interaction';
import type { ExtensionContributionRegistryView } from '@shared/types/extensions';
type RespondToInteraction = (interaction: AgentLoopInteraction, response: AgentLoopInteractionResponse) => Promise<void>;
interface AgentInteractionsPanelProps {
    readonly interactions: readonly AgentLoopInteraction[];
    readonly extensionRegistry?: ExtensionContributionRegistryView | null;
    readonly extensionProjectPaths?: readonly string[];
    onRespond: RespondToInteraction;
}
export declare function AgentInteractionsPanel({ interactions, extensionRegistry, extensionProjectPaths, onRespond, }: AgentInteractionsPanelProps): import("node_modules/@types/react").JSX.Element | null;
export {};
