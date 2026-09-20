import type { SessionId } from '@shared/types/brand'
import type {
  ChangeRequestDetailsResult,
  ChangeRequestPanelResult,
  MergeChangeRequestPayload,
  SourceControlFailure,
  VcsChangeRequestDetails,
} from '@shared/types/git'
import * as Effect from 'effect/Effect'
import { SessionResourceRepository } from '../../ports/session-resource-repository'
import type { SourceControlProvider } from '../../ports/source-control-provider'
import { resolveChangeRequestIdentity } from './change-request-identity'
import { runGit } from './shared'

const MAX_SESSION_CHANGE_REQUESTS = 50

export const SESSION_CHANGE_REQUEST_MISMATCH: SourceControlFailure = {
  ok: false,
  code: 'invalid-target',
  message: 'This change request does not belong to the opened Session.',
}

export const NO_SOURCE_CONTROL_PROVIDER: SourceControlFailure = {
  ok: false,
  code: 'unknown',
  message: 'No supported source control provider.',
}

export interface ResolvedChangeRequestProvider {
  readonly provider: SourceControlProvider
  readonly info: { readonly id: 'github' | 'gitlab'; readonly host: string }
  readonly remoteUrl: string
}

function verifiedDetails(
  resolved: ResolvedChangeRequestProvider,
  result: ChangeRequestDetailsResult,
  expectedReference: string,
): ChangeRequestDetailsResult {
  if (!result.ok) return result
  const identity = resolveChangeRequestIdentity(
    resolved.remoteUrl,
    resolved.info.id,
    result.changeRequest.url,
  )
  if (!identity || identity.reference !== expectedReference) {
    return SESSION_CHANGE_REQUEST_MISMATCH
  }
  return { ok: true, changeRequest: { ...result.changeRequest, url: identity.url } }
}

async function currentRef(workingPath: string) {
  const result = await runGit(workingPath, ['branch', '--show-current'])
  const ref = result.code === 0 ? result.stdout.trim() : ''
  return ref.length > 0 ? ref : null
}

export function requestedChangeRequestIdentity(
  resolved: ResolvedChangeRequestProvider,
  url: string,
) {
  return resolveChangeRequestIdentity(resolved.remoteUrl, resolved.info.id, url)
}

export async function loadChangeRequestPanel(
  workingPath: string,
  requestUrl: string,
  resolved: ResolvedChangeRequestProvider,
  currentBranch: string | null,
  allowedReferences: ReadonlySet<string>,
): Promise<ChangeRequestPanelResult> {
  const identity = requestedChangeRequestIdentity(resolved, requestUrl)
  if (!identity || !allowedReferences.has(identity.reference)) {
    return SESSION_CHANGE_REQUEST_MISMATCH
  }
  const [list, rawDetails] = await Promise.all([
    resolved.provider.listChangeRequests(workingPath),
    resolved.provider.getChangeRequestDetails(workingPath, identity.reference),
  ])
  if (!list.ok) return list
  const details = verifiedDetails(resolved, rawDetails, identity.reference)
  if (!details.ok) return details
  const listedRequests = list.changeRequests.flatMap((changeRequest) => {
    const requestIdentity = requestedChangeRequestIdentity(resolved, changeRequest.url)
    return requestIdentity && allowedReferences.has(requestIdentity.reference)
      ? [{ ...changeRequest, url: requestIdentity.url }]
      : []
  })
  return {
    ok: true,
    snapshot: {
      provider: resolved.info,
      currentRef: currentBranch,
      changeRequests: [
        details.changeRequest,
        ...listedRequests.filter((request) => request.url !== details.changeRequest.url),
      ],
      selected: details.changeRequest,
    },
  }
}

export function sessionOwnedChangeRequestReferences(
  sessionId: SessionId,
  workingPath: string,
  resolved: ResolvedChangeRequestProvider,
  requestedUrl: string,
) {
  return Effect.gen(function* () {
    const repository = yield* SessionResourceRepository
    const page = yield* repository.listPage(sessionId, {
      view: 'change-requests',
      limit: MAX_SESSION_CHANGE_REQUESTS,
    })
    const references = new Set(
      page.resources.flatMap((resource) => {
        if (resource.kind !== 'change-request' || !resource.isOutput || !resource.locator) return []
        const identity = requestedChangeRequestIdentity(resolved, resource.locator)
        return identity ? [identity.reference] : []
      }),
    )
    const requestedResource = yield* repository.findByLocator(
      sessionId,
      'change-request',
      requestedUrl,
    )
    if (requestedResource?.isOutput) {
      const identity = requestedChangeRequestIdentity(resolved, requestedResource.locator ?? '')
      if (identity) references.add(identity.reference)
    }
    const branch = yield* Effect.promise(() => currentRef(workingPath))
    if (branch) {
      const current = yield* Effect.promise(() =>
        resolved.provider.resolveChangeRequestForRef(workingPath, branch),
      )
      if (current.ok) {
        const identity = requestedChangeRequestIdentity(resolved, current.changeRequest.url)
        if (identity) references.add(identity.reference)
      }
    }
    return { branch, references }
  })
}

function invalidMerge(message: string): SourceControlFailure {
  return { ok: false, code: 'invalid-target', message }
}

export function validateMergeCandidate(
  resolved: ResolvedChangeRequestProvider,
  result: ChangeRequestDetailsResult,
  reference: string,
  expectedHeadCommit: string,
  method: MergeChangeRequestPayload['method'],
): VcsChangeRequestDetails | SourceControlFailure {
  const verified = verifiedDetails(resolved, result, reference)
  if (!verified.ok) return verified
  if (verified.changeRequest.headCommit !== expectedHeadCommit) {
    return invalidMerge(
      'The request head changed. Refresh and review the latest commit before merging.',
    )
  }
  if (!verified.changeRequest.merge.allowed) {
    return invalidMerge(
      verified.changeRequest.merge.reason ?? 'The provider currently blocks this merge.',
    )
  }
  if (!verified.changeRequest.merge.methods.includes(method)) {
    return invalidMerge(`The provider does not support the selected ${method} merge method.`)
  }
  return verified.changeRequest
}

export function isSourceControlFailure(
  candidate: VcsChangeRequestDetails | SourceControlFailure,
): candidate is SourceControlFailure {
  return 'ok' in candidate && candidate.ok === false
}

export function verifyMergedDetails(
  resolved: ResolvedChangeRequestProvider,
  result: ChangeRequestDetailsResult,
  expectedReference: string,
) {
  return verifiedDetails(resolved, result, expectedReference)
}
