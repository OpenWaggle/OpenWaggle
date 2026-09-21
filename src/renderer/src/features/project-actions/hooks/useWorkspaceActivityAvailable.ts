import type { ActionManagementScope } from '@shared/types/action-management'
import { useActionRuns, useNativeActions } from './useNativeActions'
import { useWorkspacePreparation } from './useWorkspacePreparation'

export function useWorkspaceActivityAvailable(scope: ActionManagementScope | null) {
  const runs = useActionRuns(scope)
  const catalog = useNativeActions(scope)
  const preparation = useWorkspacePreparation(scope)
  return Boolean(
    runs.data?.length ||
      preparation.data ||
      catalog.data?.preparation.length ||
      (catalog.data?.profiles.length ?? 0) > 1,
  )
}
