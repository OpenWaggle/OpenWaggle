import type { ConversationId } from './brand'

export type AgentPhaseLabel =
  | 'Thinking'
  | 'Writing'
  | 'Planning'
  | 'Reviewing'
  | 'Researching'
  | 'Debugging'
  | 'Refactoring'
  | 'Testing'
  | 'Documenting'
  | 'Editing'
  | 'Executing'

export interface AgentPhaseState {
  readonly label: AgentPhaseLabel
  readonly startedAt: number
}

export interface AgentPhaseEventPayload {
  readonly conversationId: ConversationId
  readonly phase: AgentPhaseState | null
}
