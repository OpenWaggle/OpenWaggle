import type {
  ProjectAction,
  ProjectActionInput,
  ProjectActionUpdate,
  T3ProjectActionsDiscovery,
} from '@shared/types/project-actions'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { OpenWaggleQueryOptions } from '@/queries/query-options'
import { api } from '@/shared/lib/ipc'

const PROJECT_ACTIONS_QUERY = 'project-actions'
const T3_PROJECT_ACTIONS_QUERY = 't3-project-actions'

export function projectActionsQueryKey(projectPath: string | null) {
  return [PROJECT_ACTIONS_QUERY, projectPath] as const
}

export function t3ProjectActionsQueryKey(projectPath: string | null) {
  return [T3_PROJECT_ACTIONS_QUERY, projectPath] as const
}

export function projectActionsQueryOptions(
  projectPath: string | null,
): OpenWaggleQueryOptions<
  readonly ProjectAction[],
  Error,
  readonly ProjectAction[],
  ReturnType<typeof projectActionsQueryKey>
> {
  return queryOptions({
    queryKey: projectActionsQueryKey(projectPath),
    queryFn: () =>
      projectPath === null ? Promise.resolve([]) : api.listProjectActions(projectPath),
    enabled: projectPath !== null,
  })
}

export function t3ProjectActionsQueryOptions(
  projectPath: string | null,
): OpenWaggleQueryOptions<
  T3ProjectActionsDiscovery,
  Error,
  T3ProjectActionsDiscovery,
  ReturnType<typeof t3ProjectActionsQueryKey>
> {
  return queryOptions({
    queryKey: t3ProjectActionsQueryKey(projectPath),
    queryFn: () => {
      if (projectPath === null) {
        return Promise.resolve<T3ProjectActionsDiscovery>({
          status: 'missing',
          scripts: [],
          candidates: [],
        })
      }
      return api.discoverT3ProjectActions(projectPath)
    },
    enabled: projectPath !== null,
  })
}

export function useProjectActions(projectPath: string | null) {
  return useQuery(projectActionsQueryOptions(projectPath))
}

export function useT3ProjectActions(projectPath: string | null) {
  return useQuery(t3ProjectActionsQueryOptions(projectPath))
}

type ProjectActionMutation =
  | { readonly type: 'add'; readonly input: ProjectActionInput }
  | { readonly type: 'update'; readonly actionId: string; readonly update: ProjectActionUpdate }
  | { readonly type: 'delete'; readonly actionId: string }
  | { readonly type: 'import'; readonly sourceIndex: number }

async function mutateProjectActions(projectPath: string | null, request: ProjectActionMutation) {
  if (projectPath === null) throw new Error('Open a project before editing actions.')
  if (request.type === 'add') return api.addProjectAction(projectPath, request.input)
  if (request.type === 'update') {
    return api.updateProjectAction(projectPath, request.actionId, request.update)
  }
  if (request.type === 'delete') return api.deleteProjectAction(projectPath, request.actionId)
  return api.importT3ProjectAction(projectPath, request.sourceIndex)
}

export function useProjectActionMutations(projectPath: string | null) {
  const queryClient = useQueryClient()
  const mutation = useMutation<readonly ProjectAction[], Error, ProjectActionMutation>({
    mutationFn: (request) => mutateProjectActions(projectPath, request),
    onSuccess: async (actions) => {
      queryClient.setQueryData(projectActionsQueryKey(projectPath), actions)
      await queryClient.invalidateQueries({ queryKey: t3ProjectActionsQueryKey(projectPath) })
    },
  })

  return {
    add: (input: ProjectActionInput) => mutation.mutateAsync({ type: 'add', input }),
    update: (actionId: string, update: ProjectActionUpdate) =>
      mutation.mutateAsync({ type: 'update', actionId, update }),
    delete: (actionId: string) => mutation.mutateAsync({ type: 'delete', actionId }),
    importT3: (sourceIndex: number) => mutation.mutateAsync({ type: 'import', sourceIndex }),
    isSaving: mutation.isPending,
  }
}
