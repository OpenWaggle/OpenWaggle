import type { FollowUpId, RunId, SessionId } from '@shared/types/brand'
import type { SessionRunTerminalStatus } from '@shared/types/session-host-event'
import { Context, type Effect } from 'effect'
import type { SessionControlIntentSnapshot } from '../domain/session-control/message-aggregate'
import type { UndeliveredSteer } from '../domain/session-control/undelivered-steering'
import type { SessionControlRepositoryError } from '../errors'

export type SessionControlTerminalRunStatus = SessionRunTerminalStatus

export type SessionControlRunActivationResult =
  | {
      readonly accepted: true
      readonly stateRevision: number
      readonly intent: SessionControlIntentSnapshot
    }
  | {
      readonly accepted: false
      readonly code:
        | 'run_not_starting'
        | 'run_not_active'
        | 'run_changed'
        | 'parent_concurrency_limit_reached'
        | 'host_run_ceiling_reached'
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
    readonly hostRunCeiling?: number
  }) => Effect.Effect<SessionControlRunActivationResult, SessionControlRepositoryError>
  readonly replaceWithExternal?: (input: {
    readonly sessionId: SessionId
    readonly previousRunId?: RunId
    readonly runId: RunId
    readonly intent: SessionControlIntentSnapshot
    readonly hostRunCeiling?: number
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
    /**
     * When the Run's terminal event reached clients (Session Control clock). A failed or interrupted
     * Run pauses only the Follow-ups accepted by then; later ones were sent after the Run was seen
     * to end and start normally. Omitted when unknown: every Follow-up is treated as earlier.
     */
    readonly terminalEventAt?: number
    readonly finalResponse?: string
    readonly suppressFollowUpScheduling?: boolean
    /**
     * Steering messages the Run ended without incorporating, in steering order. Settlement
     * returns them to the front of the Follow-up queue before it pauses or schedules the queue.
     */
    readonly undeliveredSteers?: readonly UndeliveredSteer[]
  }) => Effect.Effect<SessionControlRunSettlementResult, SessionControlRepositoryError>
  readonly recoverHostLoss: Effect.Effect<
    readonly { readonly sessionId: SessionId; readonly runId: RunId }[],
    SessionControlRepositoryError
  >
}

export class SessionControlRunLifecycleRepository extends Context.Tag(
  '@openwaggle/SessionControlRunLifecycleRepository',
)<SessionControlRunLifecycleRepository, SessionControlRunLifecycleRepositoryShape>() {}
