export type SessionRunAvailability =
  | { readonly state: 'idle' }
  | { readonly state: 'starting'; readonly runId: string }
  | { readonly state: 'active'; readonly runId: string }
  | { readonly state: 'stopping'; readonly runId: string }

export interface FollowUpQueueSnapshot {
  readonly pendingCount: number
  readonly state: 'running' | 'paused'
  /** The head Follow-up is pending, so a running queue would deliver it next. */
  readonly headDeliverable: boolean
}

export interface MessageSubmissionSnapshot {
  readonly run: SessionRunAvailability
  readonly followUpQueue: FollowUpQueueSnapshot
}

export type MessageSubmissionPlan =
  | { readonly action: 'start-run' }
  | { readonly action: 'append-follow-up' }

/** Whether the queue is about to start its next Follow-up on its own. */
function queueWillDeliver(queue: FollowUpQueueSnapshot) {
  return queue.pendingCount > 0 && queue.state === 'running' && queue.headDeliverable
}

/**
 * A message joins the queue while a Run is live, or while the queue is about to deliver ahead of
 * it, so order is kept. To an idle Session whose queue will not deliver (paused after a failed Run,
 * or held by a Follow-up that needs attention) it starts a Run: joining that queue would leave it
 * waiting for a Resume, and it is the user's answer to the failure. The held items stay held.
 */
export function planMessageSubmission(snapshot: MessageSubmissionSnapshot): MessageSubmissionPlan {
  if (snapshot.run.state === 'idle' && !queueWillDeliver(snapshot.followUpQueue)) {
    return { action: 'start-run' }
  }
  return { action: 'append-follow-up' }
}
