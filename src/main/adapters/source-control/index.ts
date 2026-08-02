import type { SourceControlProviderId } from '@shared/types/git'
import type { SourceControlProvider } from '../../ports/source-control-provider'
import { githubProvider } from './gh-cli-adapter'
import { gitlabProvider } from './glab-cli-adapter'

/** Select the CLI-backed source control provider adapter for a provider id. */
export function getSourceControlProvider(
  id: SourceControlProviderId | null | undefined,
): SourceControlProvider | null {
  if (id === 'github') return githubProvider
  if (id === 'gitlab') return gitlabProvider
  return null
}

export { githubProvider, gitlabProvider }
