import type { FollowUpId, RunId, SessionId } from '@shared/types/brand'
import { Context, type Effect } from 'effect'
import type { SessionControlIntentSnapshot } from '../domain/session-control/message-aggregate'
import type { SessionControlRepositoryError } from '../errors'

export type SessionControlTerminalRunStatus =
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'interrupted-by-interaction-timeout'

export type SessionControlRunActivationResult =
  | {
      readonly accepted: true
      readonly stateRevision: number
      readonly intent: SessionControlIntentSnapshot
    }
  | {
      readonly accepted: false
      readonly code: 'run_not_starting' | 'run_not_active' | 'run_changed'
    }

export type SessionControlRunSettlementResult =
  | {
      readonly accepted: true
      readonly stateRevision: number
      readonly delegationUpdate?: {
        readonly delegationId: string
        readonly parentSessionId: SessionId
        readonly state: 'ready_for_review' | 'needs_attention'
        readonly submissionRevision?: number
      }
      readonly orchestrationUpdate?: {
        readonly updateId: string
        readonly parentSessionId: SessionId
        readonly workerSessionId: SessionId
        readonly delegationId: string
        readonly sourceRunId: RunId
        readonly state: 'ready_for_review' | 'needs_attention'
      }
      readonly scheduled?: {
        readonly followUpId: FollowUpId
        readonly runId: RunId
        readonly intent: SessionControlIntentSnapshot
      }
    }
  | {
      readonly accepted: false
      readonly code: 'run_not_starting' | 'run_not_active' | 'run_changed'
    }

export interface SessionControlRunLifecycleRepositoryShape {
  readonly startExternal?: (input: {
    readonly sessionId: SessionId
    readonly runId: RunId
    readonly intent: SessionControlIntentSnapshot
  }) => Effect.Effect<SessionControlRunActivationResult, SessionControlRepositoryError>
  readonly replaceWithExternal?: (input: {
    readonly sessionId: SessionId
    readonly previousRunId?: RunId
    readonly runId: RunId
    readonly intent: SessionControlIntentSnapshot
  }) => Effect.Effect<SessionControlRunActivationResult, SessionControlRepositoryError>
  readonly activate: (input: {
    readonly sessionId: SessionId
    readonly runId: RunId
  }) => Effect.Effect<SessionControlRunActivationResult, SessionControlRepositoryError>
  readonly settle: (input: {
    readonly sessionId: SessionId
    readonly runId: RunId
    readonly nextRunId: RunId
    readonly terminalStatus: SessionControlTerminalRunStatus
    readonly finalResponse?: string
    readonly suppressFollowUpScheduling?: boolean
  }) => Effect.Effect<SessionControlRunSettlementResult, SessionControlRepositoryError>
  readonly recoverHostLoss: Effect.Effect<
    readonly { readonly sessionId: SessionId; readonly runId: RunId }[],
    SessionControlRepositoryError
  >
}

export class SessionControlRunLifecycleRepository extends Context.Tag(
  '@openwaggle/SessionControlRunLifecycleRepository',
)<SessionControlRunLifecycleRepository, SessionControlRunLifecycleRepositoryShape>() {}
