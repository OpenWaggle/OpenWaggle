import type {
  SessionControlFollowUpMutationRequest,
  SessionControlMutationRequest,
  SessionControlMutationResponse,
} from '@shared/types/session-control'

/** Prefix of the Follow-up a Delegation revision request queues on the Worker. */
const DELEGATION_REVISION_KEY_PREFIX = 'delegation-revision:'

/** What sent the Worker back to work. */
export type DelegationRevisionCause = 'review' | 'reopen' | 'amend' | 'dependency'

const WHAT_HAPPENED: Readonly<Record<DelegationRevisionCause, (submission: string) => string>> = {
  review: (submission) => `reviewed submission ${submission} of your Delegation`,
  reopen: (submission) => `reopened submission ${submission} of your Delegation after accepting it`,
  amend: (submission) => `changed your Delegation's task after submission ${submission}`,
  dependency: (submission) =>
    `changed what your Delegation waits for after submission ${submission}`,
}

/**
 * The Host-authored message a Worker receives when its parent sends it back to work: a revision
 * request (with feedback only or a revised specification), a reopen of its accepted result, or a
 * task change (amendment or dependency) while its result awaited review. It names the Delegation,
 * the submission revision the parent set aside and the parent's feedback or reason. A changed
 * specification itself reaches the Worker as its own Delegation specification update.
 */
export function delegationRevisionMessage(input: {
  readonly cause: DelegationRevisionCause
  readonly delegationId: string
  readonly parentSessionId: string
  readonly submissionRevision: number
  readonly feedback: string
  readonly specificationRevision?: number
}) {
  const what = WHAT_HAPPENED[input.cause](String(input.submissionRevision))
  const specification =
    input.specificationRevision === undefined
      ? ''
      : ` The specification is now revision ${String(input.specificationRevision)}, delivered as a Delegation specification update.`
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

type RevisionMessageInput = Parameters<typeof delegationRevisionMessage>[0]

/** The message for a command that sent its Worker back to work, or undefined. */
function revisionMessageInput(
  request: SessionControlMutationRequest,
  response: SessionControlMutationResponse,
): (RevisionMessageInput & { readonly workerSessionId: string }) | undefined {
  const { command } = request
  const { outcome } = response
  if (outcome.effect === 'delegation-updated') {
    if (outcome.delegationState !== 'revision_requested') return undefined
    if (
      command.operation !== 'delegation-request-revision' &&
      command.operation !== 'delegation-reopen'
    ) {
      return undefined
    }
    return {
      cause: command.operation === 'delegation-reopen' ? 'reopen' : 'review',
      delegationId: outcome.delegationId,
      parentSessionId: outcome.parentSessionId,
      workerSessionId: outcome.workerSessionId,
      submissionRevision: outcome.submissionRevision,
      feedback: command.operation === 'delegation-reopen' ? command.reason : command.feedback,
      ...(outcome.specificationChanged
        ? { specificationRevision: outcome.specificationRevision }
        : {}),
    }
  }
  if (
    outcome.effect !== 'delegation-specification-amended' &&
    outcome.effect !== 'delegation-dependencies-updated'
  ) {
    return undefined
  }
  if (!outcome.revisionRequest || outcome.delegationState !== 'revision_requested') return undefined
  if (command.operation !== 'delegation-amend' && command.operation !== 'delegation-dependency') {
    return undefined
  }
  return {
    cause: command.operation === 'delegation-amend' ? 'amend' : 'dependency',
    delegationId: outcome.delegationId,
    parentSessionId: outcome.revisionRequest.parentSessionId,
    workerSessionId: outcome.workerSessionId,
    submissionRevision: outcome.revisionRequest.submissionRevision,
    feedback: command.reason.trim(),
    specificationRevision: outcome.specificationRevision,
  }
}

/**
 * The Follow-up that sends a Worker back to work after its parent requested a revision, reopened
 * its accepted result, or changed its task while its result awaited review; undefined for any
 * other command. The Delegation is then `revision_requested`, whose next actor is the Worker, so
 * the Worker must have a Run: the Follow-up starts one on an idle Worker and queues after a busy
 * Worker's current Run, whose settlement then waits for it instead of taking that Run's reply as
 * the revision. It acts for the reviewer, as a Follow-up the reviewer sent would. A replayed
 * command already queued it.
 */
export function delegationRevisionFollowUp(
  request: SessionControlMutationRequest,
  response: SessionControlMutationResponse,
): SessionControlFollowUpMutationRequest | undefined {
  if (response.replayed) return undefined
  const message = revisionMessageInput(request, response)
  if (!message) return undefined
  const { workerSessionId, ...messageInput } = message
  return {
    contractVersion: request.contractVersion,
    requestId: `${DELEGATION_REVISION_KEY_PREFIX}${request.requestId}`,
    idempotencyKey: `${DELEGATION_REVISION_KEY_PREFIX}${request.idempotencyKey}`,
    command: {
      operation: 'follow-up',
      sessionId: workerSessionId,
      input: { text: delegationRevisionMessage(messageInput), attachmentIds: [] },
    },
  }
}
