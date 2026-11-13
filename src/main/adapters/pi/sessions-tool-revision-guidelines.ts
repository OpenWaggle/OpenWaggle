/**
 * What the Hive tool tells agents about revision requests (#454): a reviewer's
 * `delegation_request_revision` or `delegation_reopen`, or a `delegation_amend` or
 * `delegation_dependency` on a `ready_for_review` result, reaches the Worker as the reviewer's
 * Follow-up (`delegation-revision-follow-up.ts`), which starts the Worker's next Run.
 */

/**
 * For a reviewer, in the system prompt, right after "request revision". Kept to a few words for
 * the first-turn prefix budget: `help` has the full rule, including reopens and task changes, and
 * the Worker's side needs no system-prompt line because the request it receives says what to do.
 */
export const REVISION_STARTS_WORKER_RUN = "(it starts the Worker's Run with the feedback)"

/** For a Worker, in `help`. */
const REVISION_ARRIVES =
  'A revision request from your parent arrives as its Follow-up starting "OpenWaggle Delegation revision request", naming delegationId, submissionRevision and feedback; address the feedback and submit a new revision.'

/** The full revision rules for `help`, for the review actions this Session may use. */
export function revisionGuideline(permits: (action: string) => boolean) {
  const reviews = ['delegation_request_revision', 'delegation_reopen'].filter(permits)
  const taskChanges = ['delegation_amend', 'delegation_dependency'].filter(permits)
  const arrives = permits('delegation_submit') ? REVISION_ARRIVES : ''
  if (reviews.length === 0 && taskChanges.length === 0) return arrives || undefined
  const sendsBack = [
    ...(reviews.length ? [reviews.join(' and ')] : []),
    ...(taskChanges.length
      ? [
          `${taskChanges.join(' or ')} on a submitted result the Worker waits on you for (ready_for_review, needs_attention or waiting)`,
        ]
      : []),
  ].join(', and ')
  const verb = reviews.length + taskChanges.length > 1 ? 'send' : 'sends'
  return [
    `${sendsBack} ${verb} the Worker back to work (revision_requested): the Host queues "OpenWaggle Delegation revision request" on the Worker as your Follow-up, with delegationId, parentSessionId, submissionRevision, feedback (the reason, for a reopen or a task change), and specificationRevision when the task changed.`,
    "An idle Worker starts a Run on it at once; a busy Worker runs it after its current Run, and that current Run's reply does not count as the new revision.",
    'A changed task also reaches the Worker as its own Delegation specification update.',
    taskChanges.length
      ? `${taskChanges.join(' or ')} on a Worker still on the task (working or revision_requested) sends no Follow-up: the new specification reaches its current or next Run.`
      : '',
    'If you may not message the Worker (no sessions:message for it), any of these that would send it back to work is refused with worker_message_denied and the Delegation does not change; ask the user to send the revision.',
    'If the Worker is idle and a Worker limit is full, it is refused with parent_concurrency_limit_reached or host_run_ceiling_reached and the Delegation does not change; retry it once a Worker Run ends.',
    arrives,
  ]
    .filter(Boolean)
    .join(' ')
}
