import type { ActionCatalog, ActionCatalogEdit } from '@shared/types/action-definitions'
import type { ActionManagementScope } from '@shared/types/action-management'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useChat } from '@/features/chat/hooks'
import type { OpenWaggleQueryOptions } from '@/queries/query-options'
import { api } from '@/shared/lib/ipc'

const PROJECT_QUERY_PREFIX_LENGTH = 2
const CATALOG_REFRESH_MS = 5_000
const RUN_REFRESH_MS = 1_000
export const actionQueryKey = (scope: ActionManagementScope | null) =>
  [
    'native-actions',
    scope?.projectPath ?? null,
    scope?.sessionId ?? scope?.workspaceId ?? null,
  ] as const

export function useActionScope(projectPath: string | null): ActionManagementScope | null {
  const { activeSession } = useChat()
  if (!projectPath) return null
  return {
    projectPath,
    ...(activeSession?.projectPath === projectPath ? { sessionId: activeSession.id } : {}),
  }
}

const catalogKey = (scope: ActionManagementScope | null) =>
  [...actionQueryKey(scope), 'catalog'] as const
export function nativeActionCatalogOptions(
  scope: ActionManagementScope | null,
): OpenWaggleQueryOptions<ActionCatalog, Error, ActionCatalog, ReturnType<typeof catalogKey>> {
  return queryOptions({
    queryKey: catalogKey(scope),
    enabled: scope !== null,
    refetchInterval: CATALOG_REFRESH_MS,
    queryFn: async () => {
      if (!scope) throw new Error('Open a project to manage actions.')
      const result = await api.manageProjectActions({ scope, operation: { type: 'catalog' } })
      if (result.type !== 'catalog') throw new Error('Unexpected action catalog response.')
      return result.catalog
    },
  })
}

export function useNativeActions(scope: ActionManagementScope | null) {
  return useQuery(nativeActionCatalogOptions(scope))
}

export function useActionRuns(scope: ActionManagementScope | null) {
  return useQuery(
    queryOptions({
      queryKey: [...actionQueryKey(scope), 'runs'],
      enabled: Boolean(scope?.sessionId),
      refetchInterval: RUN_REFRESH_MS,
      queryFn: async () => {
        if (!scope) return []
        const result = await api.manageProjectActions({ scope, operation: { type: 'runs' } })
        if (result.type !== 'runs') throw new Error('Unexpected action run response.')
        return result.runs
      },
    }),
  )
}

export function useActionDiscovery(scope: ActionManagementScope | null, enabled = true) {
  return useQuery(
    queryOptions({
      queryKey: [...actionQueryKey(scope), 'discovery'],
      enabled: scope !== null && enabled,
      staleTime: 0,
      refetchInterval: CATALOG_REFRESH_MS,
      queryFn: async () => {
        if (!scope) throw new Error('Open a project to discover tasks.')
        const result = await api.manageProjectActions({ scope, operation: { type: 'discover' } })
        if (result.type !== 'discovery') throw new Error('Unexpected task discovery response.')
        return result.discovery
      },
    }),
  )
}

export function useEditActionCatalog(scope: ActionManagementScope | null) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({
      revision,
      edit,
    }: {
      readonly revision: string
      readonly edit: ActionCatalogEdit
    }) => {
      if (!scope) throw new Error('Open a project to manage actions.')
      const result = await api.manageProjectActions({
        scope,
        operation: { type: 'edit', revision, edit },
      })
      if (result.type !== 'catalog') throw new Error('Unexpected action save response.')
      return result.catalog
    },
    onSuccess: async (catalog) => {
      client.setQueryData(nativeActionCatalogOptions(scope).queryKey, catalog)
      await client.invalidateQueries({
        queryKey: actionQueryKey(scope).slice(0, PROJECT_QUERY_PREFIX_LENGTH),
      })
    },
  })
}
