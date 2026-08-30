export type SessionRunAvailability =
  | { readonly state: 'idle' }
  | { readonly state: 'starting'; readonly runId: string }
  | { readonly state: 'active'; readonly runId: string }
  | { readonly state: 'stopping'; readonly runId: string }

export interface FollowUpQueueSnapshot {
  readonly pendingCount: number
}

export interface MessageSubmissionSnapshot {
  readonly run: SessionRunAvailability
  readonly followUpQueue: FollowUpQueueSnapshot
}

export type MessageSubmissionPlan =
  | { readonly action: 'start-run' }
  | { readonly action: 'append-follow-up' }

export function planMessageSubmission(snapshot: MessageSubmissionSnapshot): MessageSubmissionPlan {
  if (snapshot.run.state === 'idle' && snapshot.followUpQueue.pendingCount === 0) {
    return { action: 'start-run' }
  }
  return { action: 'append-follow-up' }
}
