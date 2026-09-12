import type { OpenChangeRequestPayload, SourceControlRepositoryIdentity } from '@shared/types/git'
import { buildHostedChangeRequestUrl } from '@shared/utils/change-request-browser-url'
import { getSourceControlProvider } from '../../adapters/source-control'
import { resolvePrimaryRemote, resolvePrimaryRemoteUrl } from './primary-remote'
import { repositoryWebUrl } from './repository-web-url'
import { detectSourceControlProvider, parseRemoteRepositoryIdentity } from './vcs-status-parse'

function repositoryIdentityWebUrl(repository: SourceControlRepositoryIdentity) {
  return `https://${repository.host}/${repository.owner}/${repository.repository}`
}

export async function buildChangeRequestFallbackUrl(
  projectPath: string,
  payload: OpenChangeRequestPayload,
  headRefAvailableRemotely: boolean,
  resolvedRemoteUrl?: string,
) {
  if (payload.targetRepository) {
    return buildHostedChangeRequestUrl(
      payload.targetRepository.provider,
      repositoryIdentityWebUrl(payload.targetRepository),
      payload,
      headRefAvailableRemotely,
    )
  }
  const remoteUrl = resolvedRemoteUrl ?? (await resolvePrimaryRemoteUrl(projectPath))
  if (!remoteUrl) return null
  const provider = detectSourceControlProvider(remoteUrl)
  const webUrl = repositoryWebUrl(remoteUrl)
  if (!provider || !webUrl) return null
  return buildHostedChangeRequestUrl(provider.id, webUrl, payload, headRefAvailableRemotely)
}

export function sourceControlProviderForRepository(repository: SourceControlRepositoryIdentity) {
  const provider = getSourceControlProvider(repository.provider, repository)
  return provider
    ? {
        provider,
        info: { id: repository.provider, host: repository.host },
        repository,
      }
    : null
}

export async function resolveSourceControlProvider(projectPath: string) {
  const remote = await resolvePrimaryRemote(projectPath)
  if (!remote) return null
  const repository = parseRemoteRepositoryIdentity(remote.url)
  if (!repository) return null
  const resolved = sourceControlProviderForRepository(repository)
  return resolved ? { ...resolved, remoteName: remote.name, remoteUrl: remote.url } : null
}
