import type { UIMessage } from '@shared/types/chat-ui';
import type { AgentTransportEvent } from '@shared/types/stream';
export declare function applyAgentTransportEvent(messages: readonly UIMessage[], event: AgentTransportEvent): UIMessage[] | {
    parts: import("@shared/types/chat-ui").UIMessagePart[];
    id: string;
    role: import("@shared/types/chat-ui").ChatMessageRole;
    createdAt?: Date;
    metadata?: import("@shared/types/chat-ui").UIMessageMetadata;
}[];
