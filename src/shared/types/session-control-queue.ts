export const MAX_FOLLOW_UP_QUEUE_ITEMS = 256

/**
 * Why a Follow-up queue stopped delivering. Recorded when the queue goes from running to paused and
 * cleared on resume, so the queue can say what paused it instead of only that it is paused.
 */
export const FOLLOW_UP_QUEUE_PAUSE_REASONS = [
  'requested',
  'run-failed',
  'run-interrupted',
  'run-timed-out',
  'parent-limit',
  'host-lost',
  'profile-revoked',
] as const

export type FollowUpQueuePauseReason = (typeof FOLLOW_UP_QUEUE_PAUSE_REASONS)[number]

export function isFollowUpQueuePauseReason(value: unknown): value is FollowUpQueuePauseReason {
  return FOLLOW_UP_QUEUE_PAUSE_REASONS.some((reason) => reason === value)
}

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
