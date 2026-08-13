import type { UIMessage, UIMessagePart } from '@shared/types/chat-ui';
export declare function ensureAssistantMessage(messages: readonly UIMessage[], messageId: string): UIMessage[];
export declare function findLatestAssistantMessageId(messages: readonly UIMessage[]): string | null;
export declare function findAssistantMessageIdForToolCall(messages: readonly UIMessage[], toolCallId: string): string | null;
export declare function updateAssistantParts(messages: readonly UIMessage[], messageId: string, update: (parts: UIMessagePart[]) => UIMessagePart[]): UIMessage[];
export declare function appendTextDelta(messages: readonly UIMessage[], messageId: string, delta: string): UIMessage[];
export declare function ensureThinkingStep(messages: readonly UIMessage[], messageId: string, contentIndex: number): UIMessage[];
export declare function appendThinkingDelta(messages: readonly UIMessage[], messageId: string, contentIndex: number, delta: string): UIMessage[];
export declare function stringifyToolInput(input: unknown): string;
export declare function ensureToolCall(messages: readonly UIMessage[], messageId: string, toolCallId: string, toolName: string, input?: unknown): UIMessage[];
export declare function updateToolCall(messages: readonly UIMessage[], toolCallId: string, update: (part: Extract<UIMessagePart, {
    type: 'tool-call';
}>) => UIMessagePart): {
    parts: UIMessagePart[];
    id: string;
    role: import("@shared/types/chat-ui").ChatMessageRole;
    createdAt?: Date;
    metadata?: import("@shared/types/chat-ui").UIMessageMetadata;
}[];
export declare function appendToolCallArgs(messages: readonly UIMessage[], toolCallId: string, delta: string): {
    parts: UIMessagePart[];
    id: string;
    role: import("@shared/types/chat-ui").ChatMessageRole;
    createdAt?: Date;
    metadata?: import("@shared/types/chat-ui").UIMessageMetadata;
}[];
export declare function updateToolCallInput(messages: readonly UIMessage[], toolCallId: string, input: unknown, state: string): {
    parts: UIMessagePart[];
    id: string;
    role: import("@shared/types/chat-ui").ChatMessageRole;
    createdAt?: Date;
    metadata?: import("@shared/types/chat-ui").UIMessageMetadata;
}[];
export declare function finalizeToolCallInput(messages: readonly UIMessage[], toolCallId: string, input: unknown): {
    parts: UIMessagePart[];
    id: string;
    role: import("@shared/types/chat-ui").ChatMessageRole;
    createdAt?: Date;
    metadata?: import("@shared/types/chat-ui").UIMessageMetadata;
}[];
