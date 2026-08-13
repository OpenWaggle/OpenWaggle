import type { UIMessage } from '@shared/types/chat-ui';
import type { AgentTransportEvent } from '@shared/types/stream';
export declare function startToolExecution(messages: readonly UIMessage[], event: Extract<AgentTransportEvent, {
    type: 'tool_execution_start';
}>): {
    parts: import("@shared/types/chat-ui").UIMessagePart[];
    id: string;
    role: import("@shared/types/chat-ui").ChatMessageRole;
    createdAt?: Date;
    metadata?: import("@shared/types/chat-ui").UIMessageMetadata;
}[];
export declare function updateToolExecution(messages: readonly UIMessage[], event: Extract<AgentTransportEvent, {
    type: 'tool_execution_update';
}>): {
    parts: import("@shared/types/chat-ui").UIMessagePart[];
    id: string;
    role: import("@shared/types/chat-ui").ChatMessageRole;
    createdAt?: Date;
    metadata?: import("@shared/types/chat-ui").UIMessageMetadata;
}[];
export declare function finishToolExecution(messages: readonly UIMessage[], event: Extract<AgentTransportEvent, {
    type: 'tool_execution_end';
}>): UIMessage[];
