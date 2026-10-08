import type { SessionId } from '@shared/types/brand'
import type {
  ChangeRequestDetailsResult,
  ChangeRequestMergeCandidateResult,
  MergeChangeRequestPayload,
  MergeChangeRequestResult,
  SourceControlFailure,
  VcsChangeRequestDetails,
} from '@shared/types/git'
import * as Effect from 'effect/Effect'
import { withGitMutationLock } from '../git/mutation-lock'
import {
  type BoundRequest,
  isFailure,
  SESSION_CHANGE_REQUEST_MISMATCH,
  sessionOwnedChangeRequestUrls,
  sessionRequestContext,
  verifiedDetails,
} from './session-change-requests'

function invalidMerge(message: string): SourceControlFailure {
  return { ok: false, code: 'invalid-target', message }
}

function validateMergeCandidate(
  bound: BoundRequest,
  result: ChangeRequestDetailsResult,
  payload: MergeChangeRequestPayload,
): VcsChangeRequestDetails | SourceControlFailure {
  const verified = verifiedDetails(bound, result)
  if (!verified.ok) return verified
  if (verified.changeRequest.headCommit !== payload.expectedHeadCommit) {
    return invalidMerge(
      'The request head changed. Refresh and review the latest commit before merging.',
    )
  }
  if (!verified.changeRequest.merge.allowed) {
    return invalidMerge(
      verified.changeRequest.merge.reason ?? 'The provider currently blocks this merge.',
    )
  }
  if (!verified.changeRequest.merge.methods.includes(payload.method)) {
    return invalidMerge(
      `The provider does not support the selected ${payload.method} merge method.`,
    )
  }
  return verified.changeRequest
}

function isDetailsFailure(
  candidate: VcsChangeRequestDetails | SourceControlFailure,
): candidate is SourceControlFailure {
  return 'ok' in candidate && candidate.ok === false
}

/** Validate an owned, mergeable request with the expected head before the window confirms it. */
function validatedMergeContext(
  sessionId: SessionId,
  workingPath: string,
  payload: MergeChangeRequestPayload,
) {
  return Effect.gen(function* () {
    const context = yield* sessionRequestContext(sessionId, workingPath, payload.url)
    if (isFailure(context)) return context
    const ownership = yield* sessionOwnedChangeRequestUrls(
      sessionId,
      workingPath,
      context.resolved,
      context.bindings,
      context.bound.identity.url,
    )
    if (!ownership.urls.has(context.bound.identity.url)) return SESSION_CHANGE_REQUEST_MISMATCH
    const details = yield* Effect.promise(() =>
      context.bound.binding.provider.getChangeRequestDetails(
        workingPath,
        context.bound.identity.reference,
      ),
    )
    const candidate = validateMergeCandidate(context.bound, details, payload)
    if (isDetailsFailure(candidate)) return candidate
    return { bound: context.bound, candidate }
  })
}

export function sessionChangeRequestMergeCandidate(
  sessionId: SessionId,
  workingPath: string,
  payload: MergeChangeRequestPayload,
) {
  return Effect.gen(function* () {
    const validated = yield* validatedMergeContext(sessionId, workingPath, payload)
    if ('ok' in validated) return validated
    return {
      ok: true,
      candidate: {
        provider: validated.bound.binding.info.id,
        account: validated.bound.binding.provider.account(),
        title: validated.candidate.title,
        headRef: validated.candidate.headRef,
        baseRef: validated.candidate.baseRef,
      },
    } satisfies ChangeRequestMergeCandidateResult
  })
}

/** Revalidate everything after confirmation, then merge against the exact head commit. */
export function mergeConfirmedSessionChangeRequest(
  sessionId: SessionId,
  workingPath: string,
  payload: MergeChangeRequestPayload,
) {
  return withGitMutationLock(
    workingPath,
    Effect.gen(function* () {
      const validated = yield* validatedMergeContext(sessionId, workingPath, payload)
      if ('ok' in validated) return validated
      const { bound } = validated
      const merged = yield* Effect.promise(() =>
        bound.binding.provider.mergeChangeRequest(
          workingPath,
          bound.identity.reference,
          payload.method,
          payload.expectedHeadCommit,
        ),
      )
      const verified = verifiedDetails(bound, merged)
      return verified satisfies MergeChangeRequestResult
    }),
  )
}
