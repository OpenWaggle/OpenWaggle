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

/**
 * A filesystem path that identifies a working tree — where a session's git status,
 * diffs and mutations act. For a worktree-mode session this is the Session worktree,
 * not the opened checkout.
 *
 * Branded apart from {@link RepositoryPath} so a working-tree read or mutation cannot be
 * handed a repository path by mistake. That mix-up was a real defect: a commit went to
 * the opened checkout while a worktree session was active. The only producer is
 * `resolveSessionWorkingDir`, so a `WorkingPath` always comes from the session→tree rule.
 */
export type WorkingPath = string & Brand.Brand<'WorkingPath'>

/**
 * A filesystem path that identifies a repository — where branch lists, worktree lists and
 * remotes live. A linked worktree shares `refs/` with the primary checkout, so this data
 * is per-repository, not per session (ADR 0018).
 */
export type RepositoryPath = string & Brand.Brand<'RepositoryPath'>

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
export const WorkingPath = Brand.nominal<WorkingPath>()
export const RepositoryPath = Brand.nominal<RepositoryPath>()
