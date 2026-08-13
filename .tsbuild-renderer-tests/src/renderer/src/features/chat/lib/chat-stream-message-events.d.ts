import type { UIMessage } from '@shared/types/chat-ui';
import type { AgentTransportEvent } from '@shared/types/stream';
export declare function applyAssistantMessageEvent(messages: readonly UIMessage[], event: Extract<AgentTransportEvent, {
    type: 'message_update';
}>): UIMessage[] | {
    parts: import("@shared/types/chat-ui").UIMessagePart[];
    id: string;
    role: import("@shared/types/chat-ui").ChatMessageRole;
    createdAt?: Date;
    metadata?: import("@shared/types/chat-ui").UIMessageMetadata;
}[];
