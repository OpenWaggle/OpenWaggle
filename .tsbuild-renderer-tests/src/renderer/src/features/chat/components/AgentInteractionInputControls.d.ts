import type { AgentLoopInputInteraction } from '@shared/types/agent-loop-interaction';
import type { AgentInteractionSubmit } from './agent-interaction-control-types';
export declare function AgentInteractionInputControls({ interaction, busy, submit, }: {
    readonly interaction: AgentLoopInputInteraction;
    readonly busy: boolean;
    readonly submit: AgentInteractionSubmit;
}): import("node_modules/@types/react").JSX.Element;
