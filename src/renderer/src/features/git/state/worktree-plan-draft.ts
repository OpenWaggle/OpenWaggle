import type { SessionEnvironmentMode } from '@shared/types/git'
import {
  draftWorktreePlanKey,
  PROJECTLESS_DRAFT_WORKTREE_PLAN_KEY,
  useWorktreePlanStore,
  type WorktreePlanOverride,
} from './worktree-plan-store'

export interface DraftWorktreePlanSnapshot {
  readonly projectPath: string
  readonly plan: WorktreePlanOverride
}

/**
 * Stamp the resolved composer-strip plan onto the draft key so it survives the
 * lazy session creation on the send path (review renderer-B1).
 */
export function stashDraftWorktreePlan(
  projectPath: string,
  plan: { envMode: SessionEnvironmentMode; baseRef: string | null; startFromOrigin: boolean },
) {
  const store = useWorktreePlanStore.getState()
  store.takeOverride(PROJECTLESS_DRAFT_WORKTREE_PLAN_KEY)
  store.setOverride(draftWorktreePlanKey(projectPath), plan)
}

/** Capture the resolved plan before asynchronous session creation starts. */
export function snapshotDraftWorktreePlan(projectPath: string) {
  const plan = useWorktreePlanStore.getState().bySessionId[draftWorktreePlanKey(projectPath)]
  const snapshot: DraftWorktreePlanSnapshot | undefined = plan ? { projectPath, plan } : undefined
  return snapshot
}
