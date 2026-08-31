import type { SessionEnvironmentMode } from '@shared/types/git'
import type { SessionWorktreePlan } from '@shared/types/session'
import { draftWorktreePlanKey, useWorktreePlanStore } from './worktree-plan-store'

/**
 * Stamp the resolved composer-strip plan onto the draft key so it survives the
 * lazy session creation on the send path (review renderer-B1).
 */
export function stashDraftWorktreePlan(
  projectPath: string,
  plan: { envMode: SessionEnvironmentMode; baseRef: string | null; startFromOrigin: boolean },
): void {
  useWorktreePlanStore.getState().setOverride(draftWorktreePlanKey(projectPath), plan)
}

/**
 * Flush a stashed draft plan onto a freshly-created session before its first run
 * births the worktree, so the user's pre-send choice is honoured.
 */
export function consumeDraftWorktreePlan(projectPath: string): SessionWorktreePlan | undefined {
  const override = useWorktreePlanStore.getState().takeOverride(draftWorktreePlanKey(projectPath))
  if (!override?.envMode) return undefined
  return {
    environmentMode: override.envMode,
    baseRef: override.baseRef ?? null,
    startFromOrigin: override.startFromOrigin ?? false,
  }
}
