import type { SessionId } from '@shared/types/brand'
import type {
  ChangeRequestDetailsResult,
  ChangeRequestPanelResult,
  SourceControlFailure,
  SourceControlProviderInfo,
  SourceControlRepositoryIdentity,
} from '@shared/types/git'
import { sourceControlRepositoryKey } from '@shared/types/source-control'
import * as Effect from 'effect/Effect'
import { runGit } from '../../adapters/git/run-git'
import {
  type RepositoryChangeRequestIdentity,
  resolveRepositoryChangeRequestIdentity,
} from '../../adapters/source-control/repository-context'
import { SessionResourceRepository } from '../../ports/session-resource-repository'
import type { SourceControlProvider } from '../../ports/source-control-provider'
import { verifySessionWorkingPath } from '../git/session-working-path'
import { resolveSourceControlProvider } from './change-request-provider'
import { findCurrentChangeRequest } from './fork-change-requests'
import { sourceControlSettingsAccess } from './source-control-runtime'
import { rememberingProviderForRepository, withAttention } from './working-tree-source-control'

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

export type ResolvedChangeRequestProvider = NonNullable<
  Awaited<ReturnType<typeof resolveSourceControlProvider>>
>

/** One repository change requests may come from, with a provider bound to it. */
interface ChangeRequestRepositoryBinding {
  readonly repository: SourceControlRepositoryIdentity
  readonly provider: SourceControlProvider
  readonly info: SourceControlProviderInfo
}

export interface BoundRequest {
  readonly binding: ChangeRequestRepositoryBinding
  readonly identity: RepositoryChangeRequestIdentity
}

async function currentRef(workingPath: string) {
  const result = await runGit(workingPath, ['branch', '--show-current'])
  const ref = result.code === 0 ? result.stdout.trim() : ''
  return ref.length > 0 ? ref : null
}

/** The remote's repository plus the repository its fork requests were found in, if any. */
async function repositoryBindings(
  resolved: ResolvedChangeRequestProvider,
): Promise<readonly ChangeRequestRepositoryBinding[]> {
  const origin: ChangeRequestRepositoryBinding = {
    repository: resolved.repository,
    provider: resolved.provider,
    info: resolved.info,
  }
  const access = sourceControlSettingsAccess()
  const settings = await access.read()
  const targetKey =
    settings.sourceControlChangeRequestRepositories[sourceControlRepositoryKey(resolved.repository)]
  const [host, ...rest] = targetKey?.split('/') ?? []
  const name = rest.at(-1)
  const owner = rest.slice(0, -1).join('/')
  if (!host || !owner || !name) return [origin]
  const repository = { provider: resolved.repository.provider, host, owner, repository: name }
  const provider = await rememberingProviderForRepository(repository, access)
  return provider
    ? [origin, { repository, provider, info: { id: repository.provider, host } }]
    : [origin]
}

function bindRequest(
  bindings: readonly ChangeRequestRepositoryBinding[],
  url: string,
): BoundRequest | null {
  for (const binding of bindings) {
    const identity = resolveRepositoryChangeRequestIdentity(binding.repository, url)
    if (identity) return { binding, identity }
  }
  return null
}

export function verifiedDetails(
  bound: BoundRequest,
  result: ChangeRequestDetailsResult,
): ChangeRequestDetailsResult {
  if (!result.ok) return withAttention(result, bound.binding.info)
  const identity = resolveRepositoryChangeRequestIdentity(
    bound.binding.repository,
    result.changeRequest.url,
  )
  if (!identity || identity.url !== bound.identity.url) return SESSION_CHANGE_REQUEST_MISMATCH
  return { ok: true, changeRequest: { ...result.changeRequest, url: identity.url } }
}

/**
 * Canonical URLs of the change requests a Session may inspect: Outputs it recorded, plus the
 * current branch's request in the remote's repository or the repository it was forked from.
 */
export function sessionOwnedChangeRequestUrls(
  sessionId: SessionId,
  workingPath: string,
  resolved: ResolvedChangeRequestProvider,
  bindings: readonly ChangeRequestRepositoryBinding[],
  requestedUrl: string,
) {
  return Effect.gen(function* () {
    const repository = yield* SessionResourceRepository
    const page = yield* repository.listPage(sessionId, {
      view: 'change-requests',
      limit: MAX_SESSION_CHANGE_REQUESTS,
    })
    const urls = new Set(
      page.resources.flatMap((resource) => {
        if (resource.kind !== 'change-request' || !resource.isOutput || !resource.locator) return []
        const bound = bindRequest(bindings, resource.locator)
        return bound ? [bound.identity.url] : []
      }),
    )
    const requestedResource = yield* repository.findByLocator(
      sessionId,
      'change-request',
      requestedUrl,
    )
    if (requestedResource?.isOutput) {
      const bound = bindRequest(bindings, requestedResource.locator ?? '')
      if (bound) urls.add(bound.identity.url)
    }
    const branch = yield* Effect.promise(() => currentRef(workingPath))
    let account: string | null = null
    if (branch) {
      const current = yield* Effect.promise(() =>
        findCurrentChangeRequest(
          {
            remote: { name: resolved.remoteName, url: resolved.remoteUrl },
            repository: resolved.repository,
            hostState: { host: resolved.info.host, provider: resolved.info.id, source: null },
            info: resolved.info,
            provider: resolved.provider,
            webUrl: resolved.webUrl,
          },
          workingPath,
          branch,
          sourceControlSettingsAccess(),
        ),
      )
      if (current.result.ok) {
        const bound = bindRequest(bindings, current.result.changeRequest.url)
        if (bound) urls.add(bound.identity.url)
        account = current.provider.account()
      }
    }
    return { branch, urls, account }
  })
}

interface SessionRequestContext {
  readonly resolved: ResolvedChangeRequestProvider
  readonly bindings: readonly ChangeRequestRepositoryBinding[]
  readonly bound: BoundRequest
}

/** Verify the Session owns the working path, then bind the request URL to its repositories. */
export function sessionRequestContext(
  sessionId: SessionId,
  workingPath: string,
  requestUrl: string,
) {
  return Effect.gen(function* () {
    if (!(yield* verifySessionWorkingPath(sessionId, workingPath))) {
      return SESSION_CHANGE_REQUEST_MISMATCH
    }
    const resolved = yield* Effect.promise(() => resolveSourceControlProvider(workingPath))
    if (!resolved) return NO_SOURCE_CONTROL_PROVIDER
    const bindings = yield* Effect.promise(() => repositoryBindings(resolved))
    const bound = bindRequest(bindings, requestUrl)
    if (!bound) return SESSION_CHANGE_REQUEST_MISMATCH
    return { resolved, bindings, bound } satisfies SessionRequestContext
  })
}

export function isFailure(
  value: SessionRequestContext | SourceControlFailure,
): value is SourceControlFailure {
  return 'ok' in value && value.ok === false
}

/** The Change request inspector's snapshot, run by the Session Host (ADR 0048). */
export function loadSessionChangeRequestPanel(
  sessionId: SessionId,
  workingPath: string,
  requestUrl: string,
) {
  return Effect.gen(function* () {
    const context = yield* sessionRequestContext(sessionId, workingPath, requestUrl)
    if (isFailure(context)) return context
    const { resolved, bindings, bound } = context
    const ownership = yield* sessionOwnedChangeRequestUrls(
      sessionId,
      workingPath,
      resolved,
      bindings,
      bound.identity.url,
    )
    if (!ownership.urls.has(bound.identity.url)) return SESSION_CHANGE_REQUEST_MISMATCH
    const provider = bound.binding.provider
    const [list, rawDetails] = yield* Effect.promise(() =>
      Promise.all([
        provider.listChangeRequests(workingPath),
        provider.getChangeRequestDetails(workingPath, bound.identity.reference),
      ]),
    )
    if (!list.ok) return withAttention(list, bound.binding.info)
    const details = verifiedDetails(bound, rawDetails)
    if (!details.ok) return details
    const listedRequests = list.changeRequests.flatMap((changeRequest) => {
      const listed = bindRequest([bound.binding], changeRequest.url)
      return listed && ownership.urls.has(listed.identity.url)
        ? [{ ...changeRequest, url: listed.identity.url }]
        : []
    })
    return {
      ok: true,
      snapshot: {
        provider: bound.binding.info,
        currentRef: ownership.branch,
        changeRequests: [
          details.changeRequest,
          ...listedRequests.filter((request) => request.url !== details.changeRequest.url),
        ],
        selected: details.changeRequest,
        account: provider.account() ?? ownership.account,
      },
    } satisfies ChangeRequestPanelResult
  })
}
