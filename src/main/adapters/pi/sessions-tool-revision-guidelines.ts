/**
 * What the Hive tool tells agents about revision requests (#454): a reviewer's
 * `delegation_request_revision` or `delegation_reopen` reaches the Worker as the reviewer's
 * Follow-up (`delegation-revision-follow-up.ts`), which starts the Worker's next Run.
 */

/** For a reviewer, in the system prompt. */
export const REVISION_REACHES_WORKER =
  'delegation_request_revision and delegation_reopen, and delegation_amend or delegation_dependency on a result awaiting review, also send your feedback to the Worker as your Follow-up, which starts its next Run; do not send follow_up as well.'

/** For a Worker, in the system prompt. */
export const REVISION_ARRIVES =
  'A revision request from your parent arrives as a Host-authored Follow-up naming delegationId, submissionRevision and feedback; address the feedback and submit a new revision.'

/** The full revision rules for `help`, for the review actions this Session may use. */
export function revisionGuideline(permits: (action: string) => boolean) {
  const reviews = ['delegation_request_revision', 'delegation_reopen'].filter(permits)
  const taskChanges = ['delegation_amend', 'delegation_dependency'].filter(permits)
  if (reviews.length === 0 && taskChanges.length === 0) return undefined
  const sendsBack = [
    ...(reviews.length ? [reviews.join(' and ')] : []),
    ...(taskChanges.length ? [`${taskChanges.join(' or ')} on a ready_for_review result`] : []),
  ].join(', and ')
  const verb = reviews.length + taskChanges.length > 1 ? 'send' : 'sends'
  return [
    `${sendsBack} ${verb} the Worker back to work (revision_requested): the Host queues "OpenWaggle Host-authored Delegation revision request" on the Worker as your Follow-up, with delegationId, parentSessionId, submissionRevision, feedback (the reason, for a reopen or a task change), and specificationRevision when the task changed.`,
    "An idle Worker starts a Run on it at once; a busy Worker runs it after its current Run, and that current Run's reply does not count as the new revision.",
    'A changed task also reaches the Worker as its own Delegation specification update.',
    `${taskChanges.length ? `${taskChanges.join(' or ')} on a Worker still on the task sends no Follow-up: the new specification reaches its current or next Run. ` : ''}`.trim(),
    'If you may not message the Worker (no sessions:message for it), any of these that would send it back to work is refused with worker_message_denied and the Delegation does not change; ask the user to send the revision.',
  ]
    .filter(Boolean)
    .join(' ')
}
