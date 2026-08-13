import type { AgentLoopInteraction, AgentLoopInteractionResponse } from '@shared/types/agent-loop-interaction';
export declare function AgentInteractionControls({ interaction, busy, submit, }: {
    readonly interaction: AgentLoopInteraction;
    readonly busy: boolean;
    readonly submit: (response: AgentLoopInteractionResponse) => void;
}): import("node_modules/@types/react").JSX.Element | null;
