import type { ActionCatalog, ActionCatalogEdit } from '@shared/types/action-definitions'
import type { ActionManagementScope } from '@shared/types/action-management'
import { type ActionRun, isActiveActionRun } from '@shared/types/action-runs'
import { SessionId } from '@shared/types/brand'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useChat } from '@/features/chat/hooks'
import { useSessionStatusStore } from '@/features/sessions/state'
import { queryKeys } from '@/queries/query-keys'
import type { OpenWaggleQueryOptions } from '@/queries/query-options'
import { api } from '@/shared/lib/ipc'

const PROJECT_QUERY_PREFIX_LENGTH = 2
/** While a run is active its status and output change; poll it. */
const RUN_REFRESH_MS = 1_000
/** While the agent works it may start an action run itself (`project_actions`). */
const AGENT_WORKING_REFRESH_MS = 3_000

/**
 * Project Actions are read when shown, on window focus, after a change made here, and when the
 * Session Host reports a Session's state changed (`useSessionHostRefresh`), not on a timer: the
 * 1 s run poll, the 5 s catalog, discovery, and shortcut polls made one to three Host requests a
 * second for every window with a project Session open (B7/D9). Only an active run, or a Session
 * whose agent is working and may start one, is polled.
 */
export const PROJECT_ACTIONS_QUERY_ROOT = queryKeys.projectActions

/** How often to read runs: while one is active, or while the agent may start one; else never. */
export function actionRunsRefetchInterval(
  runs: readonly Pick<ActionRun, 'status'>[] | undefined,
  agentWorking: boolean,
): number | false {
  if (runs?.some(isActiveActionRun)) return RUN_REFRESH_MS
  return agentWorking ? AGENT_WORKING_REFRESH_MS : false
}

/** Whether the scope's Session has a Run in progress (its runs and preparation may change). */
export function useScopeAgentWorking(scope: ActionManagementScope | null) {
  const sessionId = scope?.sessionId ?? null
  return useSessionStatusStore((state) => {
    if (!sessionId) return false
    const status = state.statuses.get(SessionId(sessionId))
    return status === 'working' || status === 'connecting' || status === 'waggle-running'
  })
}
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
    refetchOnWindowFocus: true,
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
  const agentWorking = useScopeAgentWorking(scope)
  return useQuery(
    queryOptions({
      queryKey: [...actionQueryKey(scope), 'runs'],
      enabled: Boolean(scope?.sessionId),
      refetchOnWindowFocus: true,
      refetchInterval: (query) => actionRunsRefetchInterval(query.state.data, agentWorking),
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
      refetchOnWindowFocus: true,
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
