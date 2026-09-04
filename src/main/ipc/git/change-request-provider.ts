import type { OpenChangeRequestPayload } from '@shared/types/git'
import { getSourceControlProvider } from '../../adapters/source-control'
import { resolvePrimaryRemoteUrl } from './primary-remote'
import { repositoryWebUrl } from './repository-web-url'
import { detectSourceControlProvider } from './vcs-status-parse'

export async function buildChangeRequestFallbackUrl(
  projectPath: string,
  payload: OpenChangeRequestPayload,
  headRefAvailableRemotely: boolean,
  resolvedRemoteUrl?: string,
) {
  const remoteUrl = resolvedRemoteUrl ?? (await resolvePrimaryRemoteUrl(projectPath))
  if (!remoteUrl) return null
  const provider = detectSourceControlProvider(remoteUrl)
  const webUrl = repositoryWebUrl(remoteUrl)
  if (!provider || !webUrl) return null
  if (provider.id === 'github') {
    const comparison = payload.baseRef
      ? `${encodeURIComponent(payload.baseRef)}...${encodeURIComponent(payload.headRef)}`
      : encodeURIComponent(payload.headRef)
    const url = new URL(
      headRefAvailableRemotely ? `${webUrl}/compare/${comparison}` : `${webUrl}/compare`,
    )
    url.searchParams.set('expand', '1')
    url.searchParams.set('title', payload.title)
    if (payload.body) url.searchParams.set('body', payload.body)
    return url.toString()
  }
  const url = new URL(`${webUrl}/-/merge_requests/new`)
  if (headRefAvailableRemotely) {
    url.searchParams.set('merge_request[source_branch]', payload.headRef)
  }
  if (payload.baseRef) url.searchParams.set('merge_request[target_branch]', payload.baseRef)
  url.searchParams.set('merge_request[title]', payload.title)
  if (payload.body) url.searchParams.set('merge_request[description]', payload.body)
  if (payload.draft) url.searchParams.set('merge_request[draft]', 'true')
  return url.toString()
}

export async function resolveSourceControlProvider(projectPath: string) {
  const remoteUrl = await resolvePrimaryRemoteUrl(projectPath)
  const info = detectSourceControlProvider(remoteUrl)
  if (!info) return null
  const provider = getSourceControlProvider(info.id)
  return provider && remoteUrl ? { provider, info, remoteUrl } : null
}
