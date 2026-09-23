import type { SessionId } from '@shared/types/brand'
import { api } from '@/shared/lib/ipc'

/** Resolve the live project catalog before a draft send can create its Session. */
export async function validateDraftWorkspacePreparation(
  projectPath: string,
  profileId: string | undefined,
) {
  const result = await api.manageProjectActions({
    scope: { projectPath },
    operation: { type: 'catalog' },
  })
  if (result.type !== 'catalog')
    throw new Error('Could not load this project’s Preparation profiles.')
  const profiles = result.catalog.profiles
  if (profiles.length > 1 && !profileId)
    throw new Error('Choose a Preparation profile for this worktree before sending.')
  if (profileId && !profiles.some(({ definition }) => definition.id === profileId))
    throw new Error(
      'This Preparation profile is no longer available. Choose another before sending.',
    )
  const selectedProfileId = profileId ?? profiles[0]?.definition.id
  if (!selectedProfileId)
    throw new Error('This project has no Preparation profile. Add one before sending.')
  return selectedProfileId
}

/** Called after lazy Session creation, before dispatching its first agent turn. */
export async function selectDraftWorkspacePreparation(
  projectPath: string,
  sessionId: SessionId,
  profileId: string,
) {
  const result = await api.manageProjectActions({
    scope: { projectPath, sessionId },
    operation: { type: 'select-preparation', profileId, expectedRevision: 0 },
  })
  if (result.type !== 'preparation' || !result.preparation)
    throw new Error('Could not select this workspace’s Preparation profile.')
}
