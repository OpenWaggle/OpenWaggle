import type { ActionManagementScope } from '@shared/types/action-management'
import type {
  PreparationOperation,
  WorkspacePreparation,
} from '@shared/types/workspace-preparation'
import {
  queryOptions,
  type UseMutationResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { api } from '@/shared/lib/ipc'
import { actionQueryKey } from './useNativeActions'

const REFRESH_MS = 1_000
type PreparationMutation = Exclude<PreparationOperation, { type: 'preparation' }>
export function useWorkspacePreparation(scope: ActionManagementScope | null): {
  readonly data: WorkspacePreparation | null | undefined
  readonly error: Error | null
  readonly mutation: UseMutationResult<WorkspacePreparation | null, Error, PreparationMutation>
} {
  const client = useQueryClient()
  const queryKey = [...actionQueryKey(scope), 'preparation']
  const query = useQuery(
    queryOptions({
      queryKey,
      enabled: Boolean(scope?.sessionId || scope?.workspaceId),
      refetchInterval: REFRESH_MS,
      queryFn: async () => {
        if (!scope) return null
        const result = await api.manageProjectActions({ scope, operation: { type: 'preparation' } })
        if (result.type !== 'preparation') throw new Error('Unexpected preparation response.')
        return result.preparation
      },
    }),
  )
  const mutation = useMutation({
    mutationFn: async (operation: Exclude<PreparationOperation, { type: 'preparation' }>) => {
      if (!scope) throw new Error('Select a Session to manage its Workspace preparation.')
      const result = await api.manageProjectActions({ scope, operation })
      if (result.type !== 'preparation') throw new Error('Unexpected preparation response.')
      return result.preparation
    },
    onSuccess: (state) => {
      client.setQueryData(queryKey, state)
    },
    onSettled: () => client.invalidateQueries({ queryKey }),
  })
  return { data: query.data, error: query.error, mutation }
}
