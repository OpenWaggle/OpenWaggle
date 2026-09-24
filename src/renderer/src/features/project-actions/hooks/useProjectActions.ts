import type { ActionDefinition } from '@shared/types/action-definitions'
import type { ActionManagementScope } from '@shared/types/action-management'
import type { ProjectAction, ProjectActionUpdate } from '@shared/types/project-actions'
import { actionExecutionKey } from '@shared/utils/action-execution-key'
import { queryOptions, useQuery } from '@tanstack/react-query'
import type { OpenWaggleQueryOptions } from '@/queries/query-options'
import { api } from '@/shared/lib/ipc'
import { actionInvocationLabel } from '../lib/native-action-display'
import { useActionScope, useEditActionCatalog, useNativeActions } from './useNativeActions'

/** Shortcut/command-palette presentation. Execution always uses the native action ID. */
function shortcutAction(definition: ActionDefinition): ProjectAction {
  return {
    ...definition,
    executionKey: actionExecutionKey(definition),
    command: actionInvocationLabel(definition.invocation),
    runOnWorktreeCreate: false,
  }
}
const SHORTCUT_REFRESH_MS = 5_000
const projectActionsQueryKey = (projectPath: string | null, scope?: ActionManagementScope | null) =>
  ['native-actions', projectPath, scope ?? null, 'shortcut-presentation'] as const

export function projectActionsQueryOptions(
  projectPath: string | null,
  scope?: ActionManagementScope | null,
): OpenWaggleQueryOptions<
  readonly ProjectAction[],
  Error,
  readonly ProjectAction[],
  ReturnType<typeof projectActionsQueryKey>
> {
  return queryOptions({
    queryKey: projectActionsQueryKey(projectPath, scope),
    refetchInterval: SHORTCUT_REFRESH_MS,
    enabled: projectPath !== null,
    queryFn: async (): Promise<readonly ProjectAction[]> => {
      if (!projectPath) return []
      const result = await api.manageProjectActions({
        scope: scope ?? { projectPath },
        operation: { type: 'catalog' },
      })
      if (result.type !== 'catalog') throw new Error('Unexpected action catalog response.')
      return result.catalog.actions.map(({ definition }) => shortcutAction(definition))
    },
  })
}

export function useProjectActions(
  projectPath: string | null,
  scopeOverride?: ActionManagementScope | null,
) {
  const activeScope = useActionScope(projectPath)
  const scope = scopeOverride === undefined ? activeScope : scopeOverride
  return useQuery(projectActionsQueryOptions(projectPath, scope))
}

export function useProjectActionMutations(
  projectPath: string | null,
  scopeOverride?: ActionManagementScope | null,
) {
  const activeScope = useActionScope(projectPath)
  const scope = scopeOverride === undefined ? activeScope : scopeOverride
  const catalog = useNativeActions(scope)
  const mutation = useEditActionCatalog(scope)
  return {
    isSaving: mutation.isPending,
    update: async (actionId: string, update: Pick<ProjectActionUpdate, 'shortcutRules'>) => {
      const entry = catalog.data?.actions.find(({ definition }) => definition.id === actionId)
      if (!entry || !catalog.data) throw new Error('Reload actions before editing this shortcut.')
      return mutation.mutateAsync({
        revision: catalog.data.revision,
        edit: {
          type: 'save-action',
          storage: 'local',
          definition: { ...entry.definition, shortcutRules: update.shortcutRules ?? [] },
        },
      })
    },
  }
}
