import type { SourceControlProviderId, SourceControlRepositoryIdentity } from '@shared/types/git'
import type { SourceControlProvider } from '../../ports/source-control-provider'
import { createGithubProvider, type SourceControlProviderOptions } from './gh-cli-adapter'
import { createGitlabProvider } from './glab-cli-adapter'

export type { SourceControlProviderOptions }

/** Select the CLI-backed source control provider adapter for a provider id. */
export function getSourceControlProvider(
  id: SourceControlProviderId | null | undefined,
  repository: SourceControlRepositoryIdentity | null,
  options: SourceControlProviderOptions = {},
) {
  if (!repository || repository.provider !== id) return null
  if (id === 'github') {
    return createGithubProvider(repository, options) satisfies SourceControlProvider | null
  }
  if (id === 'gitlab') {
    return createGitlabProvider(repository) satisfies SourceControlProvider | null
  }
  return null
}
