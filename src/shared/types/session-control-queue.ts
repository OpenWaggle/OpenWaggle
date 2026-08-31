export interface SessionControlQueueWithdrawCommand {
  readonly operation: 'queue-withdraw'
  readonly sessionId: string
  readonly followUpIds: readonly string[]
}

export interface SessionControlQueueReorderCommand {
  readonly operation: 'queue-reorder'
  readonly sessionId: string
  readonly expectedQueueRevision: number
  readonly orderedFollowUpIds: readonly string[]
}

export interface SessionControlQueuePauseCommand {
  readonly operation: 'queue-pause'
  readonly sessionId: string
  readonly expectedQueueRevision: number
}

export interface SessionControlQueueResumeCommand {
  readonly operation: 'queue-resume'
  readonly sessionId: string
  readonly expectedQueueRevision: number
}

export interface SessionControlQueueUpdateAuthorizationCommand {
  readonly operation: 'queue-update-authorization'
  readonly sessionId: string
  readonly followUpId: string
  readonly runAuthorizationOverride: AgentAuthorizationMode | null
}

export type SessionControlQueueMutationCommand =
  | SessionControlQueuePauseCommand
  | SessionControlQueueReorderCommand
  | SessionControlQueueResumeCommand
  | SessionControlQueueUpdateAuthorizationCommand
  | SessionControlQueueWithdrawCommand

import type { AgentAuthorizationMode } from './agent-authorization'
