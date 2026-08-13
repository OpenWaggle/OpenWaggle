import type { AgentLoopInteraction } from '@shared/types/agent-loop-interaction';
import type { ExtensionInteractionView } from '@/features/extensions';
export declare function agentLoopInteractionTitle(interaction: AgentLoopInteraction): string;
export declare function agentLoopInteractionMessage(interaction: AgentLoopInteraction): string | undefined;
export declare function agentLoopInteractionRequiresDesktopRenderer(interaction: AgentLoopInteraction): boolean;
export declare function toExtensionInteractionView(interaction: AgentLoopInteraction, state?: ExtensionInteractionView['state']): ExtensionInteractionView;
