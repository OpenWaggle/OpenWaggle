export const SESSION_QUERY_WAIT_TARGET_LIMIT = 8
export const SESSION_QUERY_MAX_WAIT_MS = 1_800_000

export type SessionWaitTarget =
  | { readonly sessionId: string; readonly condition: 'idle' }
  | { readonly sessionId: string; readonly condition: 'queue-empty' }
  | {
      readonly sessionId: string
      readonly condition: 'state-revision-after'
      readonly afterStateRevision: number
    }
  | {
      readonly sessionId: string
      readonly condition: 'report-delivered'
      readonly reportId: string
    }
  | {
      readonly sessionId: string
      readonly condition: 'correlated-reply'
      readonly correlationId: string
    }

export type SessionReportWaitObservation =
  | {
      readonly condition: 'report-delivered'
      readonly reportId: string
      readonly deliveryStatus: 'not-found' | 'pending' | 'delivered'
      readonly deliveredRunId?: string
      readonly deliveredAt?: number
    }
  | {
      readonly condition: 'correlated-reply'
      readonly correlationId: string
      readonly replyReportId?: string
      readonly replyToReportId?: string
      readonly sourceSessionId?: string
      readonly createdAt?: number
    }

export interface SessionWaitState {
  readonly sessionId: string
  readonly stateRevision: number
  readonly queueState: 'running' | 'paused'
  readonly queueRevision: number
  readonly activeRunId: string | null
  readonly activeRunStatus?: string
  readonly pendingFollowUpCount: number
  /** Canonical report fact observed for a report-specific wait target. */
  readonly reportObservation?: SessionReportWaitObservation
}
