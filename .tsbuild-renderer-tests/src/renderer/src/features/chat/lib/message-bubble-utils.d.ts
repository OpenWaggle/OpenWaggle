import type { UIMessage } from '@shared/types/chat-ui';
type MessagePart = UIMessage['parts'][number];
export declare function isRenderableTextPart(part: MessagePart): part is Extract<MessagePart, {
    type: 'text';
}>;
export declare function getLastRenderableTextPartIndex(parts: UIMessage['parts']): number;
export declare function countToolCallParts(parts: UIMessage['parts']): number;
export declare function hasRenderableTextPartBeforeIndex(parts: UIMessage['parts'], index: number): boolean;
export {};
