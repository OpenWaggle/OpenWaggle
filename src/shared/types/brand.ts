/**
 * Branded types — prevent mixing up strings that represent different things.
 * A ConversationId can't accidentally be passed where a MessageId is expected.
 */
declare const __brand: unique symbol
type Brand<T, B extends string> = T & { readonly [__brand]: B }

export type ConversationId = Brand<string, 'ConversationId'>
export type MessageId = Brand<string, 'MessageId'>
export type ToolCallId = Brand<string, 'ToolCallId'>
export type OrchestrationRunId = Brand<string, 'OrchestrationRunId'>
export type OrchestrationTaskId = Brand<string, 'OrchestrationTaskId'>
export type TeamConfigId = Brand<string, 'TeamConfigId'>
export type McpServerId = Brand<string, 'McpServerId'>
export type SupportedModelId = Brand<string, 'SupportedModelId'>
export type SubAgentId = Brand<string, 'SubAgentId'>
export type TaskId = Brand<string, 'TaskId'>
export type AgentMessageId = Brand<string, 'AgentMessageId'>
export type TeamId = Brand<string, 'TeamId'>

/**
 * Branded token that gates tool-approval bypass.
 * Only the waggle coordinator should create this token — prevents
 * accidental `skipApproval: true` from bypassing all tool gates.
 */
export type SkipApprovalToken = Brand<symbol, 'SkipApprovalToken'>

/** Create branded IDs from raw strings — only used at creation boundaries */
export const ConversationId = (id: string): ConversationId => id as ConversationId
export const MessageId = (id: string): MessageId => id as MessageId
export const ToolCallId = (id: string): ToolCallId => id as ToolCallId
export const OrchestrationRunId = (id: string): OrchestrationRunId => id as OrchestrationRunId
export const OrchestrationTaskId = (id: string): OrchestrationTaskId => id as OrchestrationTaskId
export const TeamConfigId = (id: string): TeamConfigId => id as TeamConfigId
export const McpServerId = (id: string): McpServerId => id as McpServerId
export const SupportedModelId = (id: string): SupportedModelId => id as SupportedModelId
export const SubAgentId = (id: string): SubAgentId => id as SubAgentId
export const TaskId = (id: string): TaskId => id as TaskId
export const AgentMessageId = (id: string): AgentMessageId => id as AgentMessageId
export const TeamId = (id: string): TeamId => id as TeamId

const SKIP_APPROVAL_SYMBOL = Symbol('SkipApprovalToken')

/** Create a SkipApprovalToken — should only be called by waggle-coordinator. */
export const createSkipApprovalToken = (): SkipApprovalToken =>
  SKIP_APPROVAL_SYMBOL as unknown as SkipApprovalToken
