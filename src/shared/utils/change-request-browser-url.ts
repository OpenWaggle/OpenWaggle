import type { OpenChangeRequestPayload, SourceControlProviderId } from '../types/git'

export function buildHostedChangeRequestUrl(
  provider: SourceControlProviderId,
  repositoryUrl: string,
  payload: OpenChangeRequestPayload,
  headRefAvailableRemotely: boolean,
) {
  if (provider === 'github') {
    if (payload.headOwner) return null
    const comparison = payload.baseRef
      ? `${encodeURIComponent(payload.baseRef)}...${encodeURIComponent(payload.headRef)}`
      : encodeURIComponent(payload.headRef)
    const url = new URL(
      headRefAvailableRemotely
        ? `${repositoryUrl}/compare/${comparison}`
        : `${repositoryUrl}/compare`,
    )
    url.searchParams.set('expand', '1')
    url.searchParams.set('title', payload.title)
    if (payload.body) url.searchParams.set('body', payload.body)
    return url.toString()
  }

  if (payload.headRepository) return null
  const url = new URL(`${repositoryUrl}/-/merge_requests/new`)
  if (headRefAvailableRemotely) {
    url.searchParams.set('merge_request[source_branch]', payload.headRef)
  }
  if (payload.baseRef) url.searchParams.set('merge_request[target_branch]', payload.baseRef)
  url.searchParams.set('merge_request[title]', payload.title)
  if (payload.body) url.searchParams.set('merge_request[description]', payload.body)
  if (payload.draft) url.searchParams.set('merge_request[draft]', 'true')
  return url.toString()
}

/** Recover the repository URL from a provider's new-request URL for cheap local recomposition. */
export function repositoryUrlFromChangeRequestUrl(
  provider: SourceControlProviderId,
  browserUrl: string,
) {
  try {
    const url = new URL(browserUrl)
    const suffix = provider === 'github' ? '/compare' : '/-/merge_requests/new'
    const index = url.pathname.lastIndexOf(suffix)
    return index > 0 ? `${url.origin}${url.pathname.slice(0, index)}` : null
  } catch {
    return null
  }
}
