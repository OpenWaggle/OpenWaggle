import { Brand } from 'effect'

/**
 * Branded types — prevent mixing up strings that represent different things.
 * A ConversationId can't accidentally be passed where a MessageId is expected.
 */
export type ConversationId = string & Brand.Brand<'ConversationId'>
export type MessageId = string & Brand.Brand<'MessageId'>
export type ToolCallId = string & Brand.Brand<'ToolCallId'>
export type OrchestrationRunId = string & Brand.Brand<'OrchestrationRunId'>
export type OrchestrationTaskId = string & Brand.Brand<'OrchestrationTaskId'>
export type TeamConfigId = string & Brand.Brand<'TeamConfigId'>
export type McpServerId = string & Brand.Brand<'McpServerId'>
export type SupportedModelId = string & Brand.Brand<'SupportedModelId'>
export type SubAgentId = string & Brand.Brand<'SubAgentId'>
export type TaskId = string & Brand.Brand<'TaskId'>
export type AgentMessageId = string & Brand.Brand<'AgentMessageId'>
export type TeamId = string & Brand.Brand<'TeamId'>

/**
 * Branded token that gates tool-approval bypass.
 * Only the waggle coordinator should create this token — prevents
 * accidental `skipApproval: true` from bypassing all tool gates.
 */
export type SkipApprovalToken = symbol & Brand.Brand<'SkipApprovalToken'>

/** Create branded IDs from raw strings — only used at creation boundaries */
export const ConversationId = Brand.nominal<ConversationId>()
export const MessageId = Brand.nominal<MessageId>()
export const ToolCallId = Brand.nominal<ToolCallId>()
export const OrchestrationRunId = Brand.nominal<OrchestrationRunId>()
export const OrchestrationTaskId = Brand.nominal<OrchestrationTaskId>()
export const TeamConfigId = Brand.nominal<TeamConfigId>()
export const McpServerId = Brand.nominal<McpServerId>()
export const SupportedModelId = Brand.nominal<SupportedModelId>()
export const SubAgentId = Brand.nominal<SubAgentId>()
export const TaskId = Brand.nominal<TaskId>()
export const AgentMessageId = Brand.nominal<AgentMessageId>()
export const TeamId = Brand.nominal<TeamId>()

const SKIP_APPROVAL_SYMBOL = Symbol('SkipApprovalToken')

/** Create a SkipApprovalToken — should only be called by waggle-coordinator. */
const SkipApprovalToken = Brand.nominal<SkipApprovalToken>()

export const createSkipApprovalToken = (): SkipApprovalToken =>
  SkipApprovalToken(SKIP_APPROVAL_SYMBOL)
