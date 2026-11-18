/**
 * What the Hive tool tells agents about revision requests (#454): a reviewer's
 * `delegation_request_revision` or `delegation_reopen`, or a `delegation_amend` or
 * `delegation_dependency` on a submitted result whose Worker waits for its parent
 * (`ready_for_review`, `needs_attention`, `waiting`), reaches the Worker as the reviewer's
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
  'A revision request from your parent arrives as its Follow-up starting "OpenWaggle Delegation revision request", naming delegationId, submissionRevision and feedback; address the feedback and submit a new revision. A Run that started before the request may not submit while it waits for your next Run (delegation_revision_pending); end that turn.'

/** The full revision rules for `help`, for the review actions this Session may use. */
function revisionGuideline(permits: (action: string) => boolean) {
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

/** The actions that start a Run on a Worker, which reopen an accepted Delegation. */
const PARENT_WORK_ACTIONS = ['message', 'start', 'follow_up', 'replace']

/**
 * New work for a Worker the parent accepted reopens its Delegation (`sqlite-delegation-attention.ts`),
 * so the answer reaches the parent as a Worker update and wakes it. Agents used to answer with
 * `report` instead, which never starts a Run, and the idle parent waited for the person.
 */
function acceptedWorkerGuideline(permits: (action: string) => boolean) {
  const sends = PARENT_WORK_ACTIONS.filter(permits)
  const listed =
    sends.length > 1 ? `${sends.slice(0, -1).join(', ')}, or ${sends.at(-1) ?? ''}` : sends[0]
  return [
    permits('delegation_accept') && listed
      ? `After delegation_accept, a ${listed} that starts a Run on that Worker reopens its Delegation (working): its reply or submission reaches you as a Worker update that wakes you when idle, and you review it again. A report never wakes you.`
      : '',
    permits('delegation_submit')
      ? 'When your parent sends you new work after accepting your Delegation, it is working again: give the result with delegation_submit or as your final reply. A report alone never wakes your parent.'
      : '',
  ]
    .filter(Boolean)
    .join(' ')
}

/** The `help` rules for sending a Worker back to work: new work after acceptance, then revisions. */
export function reviewGuidelines(permits: (action: string) => boolean) {
  return [acceptedWorkerGuideline(permits), revisionGuideline(permits)]
}
