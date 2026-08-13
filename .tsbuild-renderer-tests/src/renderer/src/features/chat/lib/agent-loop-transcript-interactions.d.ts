import type { AgentLoopInteractionKind, AgentLoopInteractionStatus } from '@shared/types/agent-loop-interaction';
import type { AgentTransportInteractionRequestEvent, AgentTransportInteractionResolvedEvent } from '@shared/types/stream';
export declare function parseInteraction(interaction: unknown): AgentTransportInteractionRequestEvent['interaction'] | null;
export declare function parseErrorInfo(error: unknown): AgentTransportInteractionResolvedEvent['error'];
export declare function parseInteractionKind(value: string | null): AgentLoopInteractionKind | null;
export declare function parseInteractionStatus(value: string | null): AgentLoopInteractionStatus | null;
