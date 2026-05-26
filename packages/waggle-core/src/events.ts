import type { WaggleAgentColor, WaggleCollaborationMode } from './config'
import type { WaggleStopReason, WaggleTurn } from './turn-policy'

export interface WaggleTurnMetadata {
  readonly turnNumber: number
  readonly agentIndex: number
  readonly agentLabel: string
  readonly agentColor: WaggleAgentColor
  readonly agentModel: string
  readonly collaborationMode: WaggleCollaborationMode
  readonly sessionId?: string
}

export type WaggleEngineEvent =
  | { readonly type: 'turn-start'; readonly meta: WaggleTurnMetadata }
  | { readonly type: 'turn-end'; readonly meta: WaggleTurnMetadata }
  | { readonly type: 'collaboration-complete'; readonly reason: WaggleStopReason }

export function metadataForWaggleTurn(input: {
  readonly turn: WaggleTurn
  readonly collaborationMode: WaggleCollaborationMode
  readonly sessionId?: string
}): WaggleTurnMetadata {
  return {
    turnNumber: input.turn.turnNumber,
    agentIndex: input.turn.agentIndex,
    agentLabel: input.turn.agent.label,
    agentColor: input.turn.agent.color,
    agentModel: input.turn.agent.model,
    collaborationMode: input.collaborationMode,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  }
}
