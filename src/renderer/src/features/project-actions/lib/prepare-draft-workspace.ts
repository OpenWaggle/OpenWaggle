import type { SessionId } from '@shared/types/brand'
import { api } from '@/shared/lib/ipc'

/** Called after lazy Session creation, before dispatching its first agent turn. */
export async function selectDraftWorkspacePreparation(
  projectPath: string,
  sessionId: SessionId,
  profileId: string | undefined,
) {
  if (!profileId) return
  const result = await api.manageProjectActions({
    scope: { projectPath, sessionId },
    operation: { type: 'select-preparation', profileId, expectedRevision: 0 },
  })
  if (result.type !== 'preparation' || !result.preparation)
    throw new Error('Could not select this workspace’s Preparation profile.')
}
