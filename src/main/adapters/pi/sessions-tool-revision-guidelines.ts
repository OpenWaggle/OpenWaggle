/**
 * What the Hive tool tells agents about revision requests (#454): a reviewer's
 * `delegation_request_revision` or `delegation_reopen` reaches the Worker as the reviewer's
 * Follow-up (`delegation-revision-follow-up.ts`), which starts the Worker's next Run.
 */

/** For a reviewer, in the system prompt. */
export const REVISION_REACHES_WORKER =
  'delegation_request_revision and delegation_reopen also send your feedback to the Worker as your Follow-up, which starts its next Run; do not send follow_up as well.'

/** For a Worker, in the system prompt. */
export const REVISION_ARRIVES =
  'A revision request from your parent arrives as a Host-authored Follow-up naming delegationId, submissionRevision and feedback; address the feedback and submit a new revision.'

/** The full revision rules for `help`, given the review actions this Session may use. */
export function revisionGuideline(reviews: readonly string[]) {
  if (reviews.length === 0) return undefined
  return [
    `${reviews.join(' and ')} ${reviews.length > 1 ? 'send' : 'sends'} the Worker back to work: the Host queues "OpenWaggle Host-authored Delegation revision request" on the Worker as your Follow-up, with delegationId, parentSessionId, submissionRevision, feedback (a reopen's reason), and specificationRevision when revisedSpecification changed the task.`,
    "An idle Worker starts a Run on it at once; a busy Worker runs it after its current Run, and that current Run's reply does not count as the new revision.",
    'A revisedSpecification also reaches the Worker as its own Delegation specification update.',
    'If you may not message the Worker (no sessions:message for it), the request is refused with worker_message_denied and the Delegation does not change; ask the user to send the revision.',
  ].join(' ')
}
