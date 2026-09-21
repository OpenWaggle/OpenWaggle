import type { ActionCatalog } from '@shared/types/action-definitions'
import type {
  PreparationExecution,
  WorkspacePreparation,
  WorkspacePreparationSnapshot,
} from '@shared/types/workspace-preparation'
import type { StoredWorkspacePreparation } from './preparation-persistence'

export const EMPTY_PREPARATION_EXECUTION: PreparationExecution = {
  status: 'idle',
  attemptId: null,
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  error: null,
  output: '',
  truncated: false,
}
export function capturePreparationSnapshot(
  catalog: ActionCatalog,
  profileId?: string,
): WorkspacePreparationSnapshot {
  if (!profileId && catalog.profiles.length > 1)
    throw new Error('Choose a Preparation profile for this Workspace before continuing.')
  const profile = catalog.profiles.find(
    ({ definition }) => definition.id === (profileId ?? 'default'),
  )?.definition
  if (!profile) throw new Error('The selected Preparation profile no longer exists.')
  return {
    profile,
    capturedAt: Date.now(),
    definitions: catalog.preparation.filter(
      ({ definition }) => definition.profileId === profile.id,
    ),
  }
}
export function preparationProjection(
  state: StoredWorkspacePreparation,
  catalog: ActionCatalog,
): WorkspacePreparation {
  const current = catalog.profiles.find(
    ({ definition }) => definition.id === state.snapshot.profile.id,
  )?.definition
  const definitions = catalog.preparation
    .filter(({ definition }) => definition.profileId === state.snapshot.profile.id)
    .map(({ definition }) => definition)
  return {
    workspaceId: state.workspaceId,
    revision: state.revision,
    snapshot: state.snapshot,
    setup: state.setup,
    cleanup: state.cleanup,
    updateAvailable:
      JSON.stringify(current) !== JSON.stringify(state.snapshot.profile) ||
      JSON.stringify(definitions) !==
        JSON.stringify(state.snapshot.definitions.map(({ definition }) => definition)),
  }
}
export function requirePreparationRevision(
  state: StoredWorkspacePreparation | null,
  expected: number,
) {
  if ((state?.revision ?? 0) !== expected)
    throw new Error('Workspace preparation changed. Reload before continuing.')
}
