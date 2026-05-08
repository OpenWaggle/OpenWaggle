import { Brand } from 'effect'

/**
 * Branded types — prevent mixing up strings that represent different things.
 * A SessionId can't accidentally be passed where a MessageId is expected.
 */
export type SessionId = string & Brand.Brand<'SessionId'>
export type PiSessionId = string & Brand.Brand<'PiSessionId'>
export type SessionNodeId = string & Brand.Brand<'SessionNodeId'>
export type SessionBranchId = string & Brand.Brand<'SessionBranchId'>
export type MessageId = string & Brand.Brand<'MessageId'>
export type ToolCallId = string & Brand.Brand<'ToolCallId'>
export type WagglePresetId = string & Brand.Brand<'WagglePresetId'>
export type SupportedModelId = string & Brand.Brand<'SupportedModelId'>
export type AgentMessageId = string & Brand.Brand<'AgentMessageId'>

/** Create branded IDs from raw strings — only used at creation boundaries */
export const SessionId = Brand.nominal<SessionId>()
export const PiSessionId = Brand.nominal<PiSessionId>()
export const SessionNodeId = Brand.nominal<SessionNodeId>()
export const SessionBranchId = Brand.nominal<SessionBranchId>()
export const MessageId = Brand.nominal<MessageId>()
export const ToolCallId = Brand.nominal<ToolCallId>()
export const WagglePresetId = Brand.nominal<WagglePresetId>()
export const SupportedModelId = Brand.nominal<SupportedModelId>()
export const AgentMessageId = Brand.nominal<AgentMessageId>()
