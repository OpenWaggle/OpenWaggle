import type { InlineVisualizationContext } from './agent'
import type { AgentAuthorizationMode } from './agent-authorization'
import type { ThinkingLevel } from './settings'
import type { WaggleInvocationInput } from './waggle'

/**
 * Message content a caller submits: what a Follow-up message carries. It names no thinking level
 * or authorization; a Run uses the Session's settings when it starts.
 */
export interface SessionControlFollowUpInput {
  readonly text: string
  readonly attachmentIds: readonly string[]
  readonly waggle?: WaggleInvocationInput
  readonly visualizationContext?: InlineVisualizationContext
}

/**
 * Input of a command that may start a Run on an idle Session (`message`, `start`).
 *
 * `thinkingLevel` sets the Session thinking level for that Run and later ones, as if chosen in the
 * Session. It is accepted only when the command starts a Run on an idle Session; a `message` that
 * would be queued instead is refused with `thinking_level_requires_idle_session`.
 */
export interface SessionControlMessageInput extends SessionControlFollowUpInput {
  readonly thinkingLevel?: ThinkingLevel
}

export interface SessionControlSteeringInput {
  readonly text: string
  readonly attachmentIds: readonly string[]
  readonly visualizationContext?: InlineVisualizationContext
}

/**
 * Starts a Run when the Session is idle and its queue will not deliver on its own; otherwise it
 * queues a Follow-up. `runAuthorizationOverride` and `input.thinkingLevel` are allowed only when it
 * starts a Run; a message that would be queued with either is refused.
 */
export interface SessionControlMessageCommand {
  readonly operation: 'message'
  readonly sessionId: string
  readonly runAuthorizationOverride?: AgentAuthorizationMode
  readonly input: SessionControlMessageInput
}

export interface SessionControlSteerCommand {
  readonly operation: 'steer'
  readonly sessionId: string
  readonly expectedRunId: string
  readonly input: SessionControlSteeringInput
}

export interface SessionControlStartCommand {
  readonly operation: 'start'
  readonly sessionId: string
  readonly runAuthorizationOverride?: AgentAuthorizationMode
  readonly interactionTimeoutMs?: number
  readonly input: SessionControlMessageInput
}

/** A Follow-up message never carries a thinking level or a Run authorization override. */
export interface SessionControlFollowUpCommand {
  readonly operation: 'follow-up'
  readonly sessionId: string
  readonly input: SessionControlFollowUpInput
}

/** Replacement acts on an active Run, so it carries no thinking level or authorization override. */
export interface SessionControlReplaceCommand {
  readonly operation: 'replace'
  readonly sessionId: string
  readonly expectedRunId: string
  readonly input: SessionControlFollowUpInput
}

export interface SessionControlPromoteCommand {
  readonly operation: 'promote'
  readonly sessionId: string
  readonly expectedRunId: string
  readonly followUpId: string
}
