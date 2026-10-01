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
  /** The head Follow-up is out for a Follow-up edit, so the queue waits on the user. */
  readonly headHeld?: boolean
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
  return (
    queue.pendingCount > 0 && queue.state === 'running' && queue.headDeliverable && !queue.headHeld
  )
}

/**
 * A message joins the queue while a Run is live, or while the queue is about to deliver ahead of
 * it, so order is kept. To an idle Session whose queue will not deliver (paused after a failed Run,
 * or held by a Follow-up that needs attention) it starts a Run: joining that queue would leave it
 * waiting for a Resume, and it is the user's answer to the failure. The held items stay held.
 * A head out for a Follow-up edit is different: the user is rewriting the next message, so a new
 * one waits behind it rather than overtaking it.
 */
export function planMessageSubmission(snapshot: MessageSubmissionSnapshot): MessageSubmissionPlan {
  if (
    snapshot.run.state === 'idle' &&
    !snapshot.followUpQueue.headHeld &&
    !queueWillDeliver(snapshot.followUpQueue)
  ) {
    return { action: 'start-run' }
  }
  return { action: 'append-follow-up' }
}
