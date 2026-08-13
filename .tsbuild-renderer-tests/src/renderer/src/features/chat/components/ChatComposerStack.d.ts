import type { AgentLoopInteraction, AgentLoopInteractionResponse } from '@shared/types/agent-loop-interaction';
import type { ExtensionContributionRegistryView } from '@shared/types/extensions';
import type { ChatComposerSectionState } from '../model';
interface ChatComposerStackProps {
    readonly section: ChatComposerSectionState;
    readonly agentInteractions?: readonly AgentLoopInteraction[];
    readonly extensionRegistry?: ExtensionContributionRegistryView | null;
    readonly extensionProjectPaths?: readonly string[];
    readonly onRespondAgentInteraction: (interaction: AgentLoopInteraction, response: AgentLoopInteractionResponse) => Promise<void>;
    readonly onOpenSessionTree?: () => void;
}
export declare function ChatComposerStack({ section, agentInteractions, extensionRegistry, extensionProjectPaths, onRespondAgentInteraction, onOpenSessionTree, }: ChatComposerStackProps): import("node_modules/@types/react").JSX.Element;
export {};
