import type { InlineVisualizationContext } from './agent'
import type { AgentAuthorizationMode } from './agent-authorization'
import type { ThinkingLevel } from './settings'
import type { WaggleInvocationInput } from './waggle'

export interface SessionControlMessageInput {
  readonly text: string
  readonly attachmentIds: readonly string[]
  readonly thinkingLevel?: ThinkingLevel
  readonly waggle?: WaggleInvocationInput
  readonly visualizationContext?: InlineVisualizationContext
}

export interface SessionControlSteeringInput {
  readonly text: string
  readonly attachmentIds: readonly string[]
  readonly visualizationContext?: InlineVisualizationContext
}

export interface SessionControlMessageCommand {
  readonly operation: 'message'
  readonly sessionId: string
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

export interface SessionControlFollowUpCommand
  extends Omit<SessionControlStartCommand, 'operation' | 'interactionTimeoutMs'> {
  readonly operation: 'follow-up'
}

export interface SessionControlReplaceCommand
  extends Omit<SessionControlStartCommand, 'operation' | 'interactionTimeoutMs'> {
  readonly operation: 'replace'
  readonly expectedRunId: string
}

export interface SessionControlPromoteCommand {
  readonly operation: 'promote'
  readonly sessionId: string
  readonly expectedRunId: string
  readonly followUpId: string
}
