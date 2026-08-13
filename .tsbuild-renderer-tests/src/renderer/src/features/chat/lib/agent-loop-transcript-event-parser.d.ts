import type { AgentTransportCustomEvent, AgentTransportInteractionRequestEvent, AgentTransportInteractionResolvedEvent } from '@shared/types/stream';
export interface AgentLoopTranscriptNode {
    readonly id: string;
    readonly parentId: string | null;
    readonly kind: string;
    readonly timestampMs: number;
    readonly createdOrder: number;
    readonly contentJson: string;
}
export declare function parseAgentLoopEvent(event: unknown): AgentTransportCustomEvent | AgentTransportInteractionRequestEvent | AgentTransportInteractionResolvedEvent | null;
export declare function isAgentLoopTranscriptNode(node: AgentLoopTranscriptNode): boolean;
export declare function readAgentLoopEventFromNode(node: AgentLoopTranscriptNode): AgentTransportCustomEvent | AgentTransportInteractionRequestEvent | AgentTransportInteractionResolvedEvent | null;
