import type { OpenChangeRequestPayload, SourceControlRepositoryIdentity } from '@shared/types/git'
import { buildHostedChangeRequestUrl } from '@shared/utils/change-request-browser-url'
import { sourceControlSettingsAccess } from './source-control-runtime'
import {
  openWorkingTreeSourceControl,
  rememberingProviderForRepository,
  repositoryWebUrlFor,
} from './working-tree-source-control'

export async function buildChangeRequestFallbackUrl(
  projectPath: string,
  payload: OpenChangeRequestPayload,
  headRefAvailableRemotely: boolean,
  resolved?: { readonly repository: SourceControlRepositoryIdentity },
) {
  if (payload.targetRepository) {
    return buildHostedChangeRequestUrl(
      payload.targetRepository.provider,
      repositoryWebUrlFor(payload.targetRepository),
      payload,
      headRefAvailableRemotely,
    )
  }
  const repository =
    resolved?.repository ?? (await resolveSourceControlProvider(projectPath))?.repository
  if (!repository) return null
  return buildHostedChangeRequestUrl(
    repository.provider,
    repositoryWebUrlFor(repository),
    payload,
    headRefAvailableRemotely,
  )
}

/** A provider bound to a target repository, as the account remembered for it (ADR 0048). */
export async function sourceControlProviderForRepository(
  repository: SourceControlRepositoryIdentity,
) {
  const provider = await rememberingProviderForRepository(repository, sourceControlSettingsAccess())
  return provider
    ? {
        provider,
        info: { id: repository.provider, host: repository.host },
        repository,
      }
    : null
}

/**
 * The provider for a working tree's primary remote, decided by the shared source-control resolver
 * (ADR 0048): the user's host choices, approved project declarations, CLI sign-ins, git hints,
 * and, when `probeRemote` is set, the remote's change-request refs.
 */
export async function resolveSourceControlProvider(
  projectPath: string,
  options: { readonly probeRemote?: boolean } = {},
) {
  const opened = await openWorkingTreeSourceControl(projectPath, sourceControlSettingsAccess(), {
    probeRemote: options.probeRemote ?? false,
  })
  const sourceControl = opened.sourceControl
  if (!sourceControl) return null
  return {
    provider: sourceControl.provider,
    info: sourceControl.info,
    repository: sourceControl.repository,
    remoteName: sourceControl.remote.name,
    remoteUrl: sourceControl.remote.url,
    webUrl: sourceControl.webUrl,
  }
}
