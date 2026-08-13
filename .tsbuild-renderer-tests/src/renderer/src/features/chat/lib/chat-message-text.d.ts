import type { UIMessage } from '@shared/types/chat-ui';
/** Extract the concatenated text content from a UIMessage's text parts. */
export declare function getUIMessageText(message: UIMessage): string;
export declare function getNonEmptyUserMessageText(message: UIMessage): string | null;
export declare function countUserMessagesByText(messages: readonly UIMessage[]): Map<string, number>;
export declare function consumeUserMessageTextCount(countsByText: Map<string, number>, text: string): boolean;
