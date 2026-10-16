import type { PiSessionContinuationChoice } from '@shared/pi-session-continuation'
import { api } from '@/shared/lib/ipc'
import type { PreferencesActions, PreferencesGet, PreferencesSet } from './preferences-store-types'

/** Remembers (or, with null, forgets) a project's Pi continuation choice for this person. */
async function setProjectPiSessionContinuation(
  projectPath: string,
  choice: PiSessionContinuationChoice | null,
  set: PreferencesSet,
  get: PreferencesGet,
) {
  const piSessionContinuationByProject = { ...get().settings.piSessionContinuationByProject }
  if (choice === null) delete piSessionContinuationByProject[projectPath]
  else piSessionContinuationByProject[projectPath] = choice
  const result = await api.updateSettings({ piSessionContinuationByProject })
  if (!result.ok) throw new Error(result.error)
  set((state) => ({ settings: { ...state.settings, piSessionContinuationByProject } }))
}

export function createPiSessionContinuationPreferencesActions(
  set: PreferencesSet,
  get: PreferencesGet,
): Pick<PreferencesActions, 'setProjectPiSessionContinuation'> {
  return {
    setProjectPiSessionContinuation: (projectPath, choice) =>
      setProjectPiSessionContinuation(projectPath, choice, set, get),
  }
}
