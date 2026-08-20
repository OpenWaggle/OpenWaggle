import type { SessionId } from '@shared/types/brand'
import type { SessionEnvironmentMode } from '@shared/types/git'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { draftWorktreePlanKey, useWorktreePlanStore } from './worktree-plan-store'

const logger = createRendererLogger('worktree-plan-draft')

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
export async function flushDraftWorktreePlanToSession(
  projectPath: string,
  sessionId: SessionId,
): Promise<void> {
  const override = useWorktreePlanStore.getState().takeOverride(draftWorktreePlanKey(projectPath))
  if (!override?.envMode) return
  await api
    .setSessionWorktreePlan(sessionId, {
      environmentMode: override.envMode,
      baseRef: override.baseRef ?? null,
      startFromOrigin: override.startFromOrigin ?? false,
    })
    .catch((error) => logger.warn('Failed to flush draft worktree plan', { error: String(error) }))
}
