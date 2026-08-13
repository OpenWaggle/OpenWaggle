import type { AgentLoopSelectInteraction } from '@shared/types/agent-loop-interaction';
import type { AgentInteractionSubmit } from './agent-interaction-control-types';
export declare function AgentInteractionSelectControls({ interaction, busy, submit, }: {
    readonly interaction: AgentLoopSelectInteraction;
    readonly busy: boolean;
    readonly submit: AgentInteractionSubmit;
}): import("node_modules/@types/react").JSX.Element;
