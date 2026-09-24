import { useCallback } from 'react'
import { draftWorktreePlanKey, useWorktreePlanStore } from '../state/worktree-plan-store'

export function useDraftPreparationProfile(projectPath: string) {
  const key = draftWorktreePlanKey(projectPath)
  const profileId = useWorktreePlanStore((state) => state.bySessionId[key]?.preparationProfileId)
  const setOverride = useWorktreePlanStore((state) => state.setOverride)
  const select = useCallback(
    (preparationProfileId: string | undefined) => setOverride(key, { preparationProfileId }),
    [key, setOverride],
  )
  return {
    profileId,
    select,
  }
}
