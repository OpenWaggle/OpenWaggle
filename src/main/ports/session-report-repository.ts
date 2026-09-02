import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import type {
  SessionControlMutationResponse,
  SessionControlReportMutationRequest,
} from '@shared/types/session-control'
import type { SessionReportWaitObservation, SessionWaitTarget } from '@shared/types/session-wait'
import { Context, type Effect } from 'effect'
import type { SessionControlRepositoryError } from '../errors'

export interface ExecuteSessionReportInput {
  readonly callerId: string
  readonly authority?: LocalSessionProfileAuthority
  readonly request: SessionControlReportMutationRequest
  readonly reportId: string
  readonly correlationId: string
  readonly now: number
}

export interface PendingSessionReport {
  readonly reportId: string
  readonly correlationId: string
  readonly replyToReportId?: string
  readonly sourceSessionId: string
  readonly sourceRunId?: string
  readonly authoredBy: string
  readonly content: string
  readonly requestReply: boolean
  readonly createdAt: number
}

export interface SessionReportRepositoryShape {
  readonly execute: (
    input: ExecuteSessionReportInput,
  ) => Effect.Effect<SessionControlMutationResponse, SessionControlRepositoryError>
  readonly listPending: (input: {
    readonly targetSessionId: string
  }) => Effect.Effect<readonly PendingSessionReport[], SessionControlRepositoryError>
  readonly markDelivered: (input: {
    readonly reportIds: readonly string[]
    readonly targetSessionId: string
    readonly runId: string
    readonly itemIds: readonly string[]
    readonly deliveredAt: number
  }) => Effect.Effect<void, SessionControlRepositoryError>
  readonly observeWaitCondition: (input: {
    readonly target: Extract<
      SessionWaitTarget,
      { readonly condition: 'report-delivered' | 'correlated-reply' }
    >
  }) => Effect.Effect<SessionReportWaitObservation, SessionControlRepositoryError>
}

export class SessionReportRepository extends Context.Tag('@openwaggle/SessionReportRepository')<
  SessionReportRepository,
  SessionReportRepositoryShape
>() {}
