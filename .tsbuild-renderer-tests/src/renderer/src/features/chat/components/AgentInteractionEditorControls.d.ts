import type { AgentLoopEditorInteraction } from '@shared/types/agent-loop-interaction';
import type { AgentInteractionSubmit } from './agent-interaction-control-types';
export declare function AgentInteractionEditorControls({ interaction, busy, submit, }: {
    readonly interaction: AgentLoopEditorInteraction;
    readonly busy: boolean;
    readonly submit: AgentInteractionSubmit;
}): import("node_modules/@types/react").JSX.Element;
