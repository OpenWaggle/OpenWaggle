import type {
  AgentLoopInteractionKind,
  AgentLoopInteractionResponse,
  AgentLoopInteractionStatus,
} from './agent-loop-interaction'

export type SessionInteractionResponseCommand = {
  readonly operation: 'request-respond' | 'approval-respond'
  readonly sessionId: string
  readonly runId: string
  readonly interactionId: string
  readonly kind: AgentLoopInteractionKind
  readonly response: AgentLoopInteractionResponse
}

export interface SessionInteractionResolvedOutcome {
  readonly operation: SessionInteractionResponseCommand['operation']
  readonly effect: 'interaction-resolved'
  readonly sessionId: string
  readonly runId: string
  readonly interactionId: string
  readonly status: AgentLoopInteractionStatus
}
