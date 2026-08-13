import type { SessionWorkspace } from '@shared/types/session';
import type { AgentTransportCustomEvent } from '@shared/types/stream';
import type { AgentInteractionEvent } from './types-chat-row';
interface AgentLoopTranscriptEvents {
    readonly customMessages: readonly AgentTransportCustomEvent[];
    readonly interactionEvents: readonly AgentInteractionEvent[];
}
export declare function readAgentLoopEventsFromWorkspace(workspace: SessionWorkspace): AgentLoopTranscriptEvents;
export declare function mergeCustomMessages(persisted: readonly AgentTransportCustomEvent[], live: readonly AgentTransportCustomEvent[]): AgentTransportCustomEvent[];
export declare function mergeInteractionEvents(persisted: readonly AgentInteractionEvent[], live: readonly AgentInteractionEvent[]): AgentInteractionEvent[];
export {};
