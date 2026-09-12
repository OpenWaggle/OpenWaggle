import type { AgentAuthorizationMode } from './agent-authorization'

export interface SessionAuthorizationSetCommand {
  readonly operation: 'authorization-set'
  readonly sessionId: string
  readonly authorizationMode: AgentAuthorizationMode | null
}

export interface SessionAuthorizationUpdatedOutcome {
  readonly operation: 'authorization-set'
  readonly effect: 'authorization-updated'
  readonly sessionId: string
  readonly authorizationMode: AgentAuthorizationMode | null
  readonly effectiveAuthorizationMode: AgentAuthorizationMode
}
