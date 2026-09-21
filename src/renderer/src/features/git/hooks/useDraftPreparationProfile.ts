import { draftWorktreePlanKey, useWorktreePlanStore } from '../state/worktree-plan-store'

export function useDraftPreparationProfile(projectPath: string) {
  const key = draftWorktreePlanKey(projectPath)
  const profileId = useWorktreePlanStore((state) => state.bySessionId[key]?.preparationProfileId)
  const setOverride = useWorktreePlanStore((state) => state.setOverride)
  return {
    profileId,
    select: (preparationProfileId: string) => setOverride(key, { preparationProfileId }),
  }
}
