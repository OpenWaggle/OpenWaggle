import type { AgentLoopInteraction, AgentLoopInteractionResponse } from '@shared/types/agent-loop-interaction';
import type { JsonValue } from '@shared/types/json';
export declare function responseFromExtensionAction(input: {
    readonly interaction: AgentLoopInteraction;
    readonly actionId: string;
    readonly payload?: JsonValue;
}): AgentLoopInteractionResponse | null;
