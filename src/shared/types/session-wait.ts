export const SESSION_QUERY_WAIT_TARGET_LIMIT = 8
export const SESSION_QUERY_MAX_WAIT_MS = 1_800_000

export interface SessionWaitState {
  readonly sessionId: string
  readonly stateRevision: number
  readonly queueState: 'running' | 'paused'
  readonly queueRevision: number
  readonly activeRunId: string | null
  readonly activeRunStatus?: string
  readonly pendingFollowUpCount: number
}
