import type { SourceControlProviderId, SourceControlRepositoryIdentity } from '@shared/types/git'
import type { SourceControlProvider } from '../../ports/source-control-provider'
import { createGithubProvider } from './gh-cli-adapter'
import { createGitlabProvider } from './glab-cli-adapter'

/** Select the CLI-backed source control provider adapter for a provider id. */
export function getSourceControlProvider(
  id: SourceControlProviderId | null | undefined,
  repository: SourceControlRepositoryIdentity | null,
): SourceControlProvider | null {
  if (!repository || repository.provider !== id) return null
  if (id === 'github') return createGithubProvider(repository)
  if (id === 'gitlab') return createGitlabProvider(repository)
  return null
}

export { createGithubProvider, createGitlabProvider }
