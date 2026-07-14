import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import type { UseQueryResult } from '@tanstack/react-query'
import { useQuery } from '@tanstack/react-query'
import { extensionContributionsQueryOptions } from '@/queries/extensions'

interface UseExtensionSidePanelContributionsInput {
  readonly enabled: boolean
  readonly projectPath: string | null
  readonly sessionId?: string | null
}

interface ExtensionSidePanelContributionsResult {
  readonly error: Error | null
  readonly loading: boolean
  readonly projectPaths: readonly string[]
  readonly refetch: UseQueryResult<ExtensionContributionRegistryView, Error>['refetch']
  readonly registry: ExtensionContributionRegistryView | null
}

function activeProjectPaths(projectPath: string | null) {
  return projectPath ? [projectPath] : []
}

export function useExtensionSidePanelContributions({
  enabled,
  projectPath,
  sessionId,
}: UseExtensionSidePanelContributionsInput): ExtensionSidePanelContributionsResult {
  const projectPaths = activeProjectPaths(projectPath)
  const queryOptions = extensionContributionsQueryOptions(projectPaths, { sessionId })
  const query = useQuery({
    ...queryOptions,
    enabled,
  })

  return {
    error: query.error,
    loading: query.isPending,
    projectPaths,
    refetch: query.refetch,
    registry: query.data ?? null,
  }
}
