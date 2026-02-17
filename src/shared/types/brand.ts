/**
 * Branded types — prevent mixing up strings that represent different things.
 * A ConversationId can't accidentally be passed where a MessageId is expected.
 */
declare const __brand: unique symbol
type Brand<T, B extends string> = T & { readonly [__brand]: B }

export type ConversationId = Brand<string, 'ConversationId'>
export type MessageId = Brand<string, 'MessageId'>
export type ToolCallId = Brand<string, 'ToolCallId'>
/** Create branded IDs from raw strings — only used at creation boundaries */
export const ConversationId = (id: string): ConversationId => id as ConversationId
export const MessageId = (id: string): MessageId => id as MessageId
export const ToolCallId = (id: string): ToolCallId => id as ToolCallId
