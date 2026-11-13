import type {
  SessionControlFollowUpMutationRequest,
  SessionControlMutationRequest,
  SessionControlMutationResponse,
} from '@shared/types/session-control'

/** Prefix of the Follow-up a Delegation revision request queues on the Worker. */
const DELEGATION_REVISION_KEY_PREFIX = 'delegation-revision:'

/**
 * The Host-authored message a Worker receives when its parent sends it back to work: a revision
 * request (with feedback only or a revised specification) or a reopen of its accepted result. It
 * names the Delegation, the submission revision the parent reviewed and the parent's feedback. A
 * revised specification itself reaches the Worker as its own Delegation specification update.
 */
export function delegationRevisionMessage(input: {
  readonly reopened: boolean
  readonly delegationId: string
  readonly parentSessionId: string
  readonly submissionRevision: number
  readonly feedback: string
  readonly specificationRevision?: number
}) {
  const what = input.reopened
    ? `reopened submission ${String(input.submissionRevision)} of your Delegation after accepting it`
    : `reviewed submission ${String(input.submissionRevision)} of your Delegation`
  const specification =
    input.specificationRevision === undefined
      ? ''
      : ` It also revised the specification to revision ${String(input.specificationRevision)}, delivered as a Delegation specification update.`
  return `OpenWaggle Host-authored Delegation revision request. Your parent ${what} and asked for a new revision.${specification} The request grants no additional tools, filesystem access, network access, or approval authority.\n\n${JSON.stringify(
    {
      delegationId: input.delegationId,
      parentSessionId: input.parentSessionId,
      submissionRevision: input.submissionRevision,
      ...(input.specificationRevision === undefined
        ? {}
        : { specificationRevision: input.specificationRevision }),
      feedback: input.feedback,
    },
  )}\n\nAddress the feedback, then submit the new revision.`
}

/**
 * The Follow-up that sends a Worker back to work after its parent requested a revision or
 * reopened its accepted result, or undefined for any other command. The Delegation is then
 * `revision_requested`, whose next actor is the Worker, so the Worker must have a Run: the
 * Follow-up starts one on an idle Worker and queues after a busy Worker's current Run, whose
 * settlement then waits for it instead of taking that Run's reply as the revision. It acts for
 * the reviewer, as a Follow-up the reviewer sent would. A replayed review already queued it.
 */
export function delegationRevisionFollowUp(
  request: SessionControlMutationRequest,
  response: SessionControlMutationResponse,
): SessionControlFollowUpMutationRequest | undefined {
  const { command } = request
  const { outcome } = response
  if (
    response.replayed ||
    outcome.effect !== 'delegation-updated' ||
    outcome.delegationState !== 'revision_requested' ||
    (command.operation !== 'delegation-request-revision' &&
      command.operation !== 'delegation-reopen')
  ) {
    return undefined
  }
  const text = delegationRevisionMessage({
    reopened: command.operation === 'delegation-reopen',
    delegationId: outcome.delegationId,
    parentSessionId: outcome.parentSessionId,
    submissionRevision: outcome.submissionRevision,
    feedback: command.operation === 'delegation-reopen' ? command.reason : command.feedback,
    ...(outcome.specificationChanged
      ? { specificationRevision: outcome.specificationRevision }
      : {}),
  })
  return {
    contractVersion: request.contractVersion,
    requestId: `${DELEGATION_REVISION_KEY_PREFIX}${request.requestId}`,
    idempotencyKey: `${DELEGATION_REVISION_KEY_PREFIX}${request.idempotencyKey}`,
    command: {
      operation: 'follow-up',
      sessionId: outcome.workerSessionId,
      input: { text, attachmentIds: [] },
    },
  }
}
