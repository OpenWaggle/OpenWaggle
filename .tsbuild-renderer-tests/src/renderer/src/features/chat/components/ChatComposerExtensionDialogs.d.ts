import type { AgentLoopInteraction, AgentLoopInteractionResponse } from '@shared/types/agent-loop-interaction';
import type { ExtensionContributionRegistryView } from '@shared/types/extensions';
interface ChatComposerExtensionDialogsProps {
    readonly agentInteractions: readonly AgentLoopInteraction[];
    readonly extensionRegistry: ExtensionContributionRegistryView | null;
    readonly extensionProjectPaths: readonly string[];
    readonly onRespond: (interaction: AgentLoopInteraction, response: AgentLoopInteractionResponse) => Promise<void>;
}
export declare function ChatComposerExtensionDialogs({ agentInteractions, extensionRegistry, extensionProjectPaths, onRespond, }: ChatComposerExtensionDialogsProps): import("node_modules/@types/react").JSX.Element;
export {};
