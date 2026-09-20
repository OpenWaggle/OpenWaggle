import { api } from '@/shared/lib/ipc'
import type { PreferencesActions, PreferencesGet, PreferencesSet } from './preferences-store-types'

async function setProjectMultiAgentEnabled(
  projectPath: string,
  enabled: boolean | null,
  set: PreferencesSet,
  get: PreferencesGet,
) {
  const { settings } = get()
  const multiAgentEnabledByProject = { ...settings.multiAgentEnabledByProject }
  if (enabled === null) delete multiAgentEnabledByProject[projectPath]
  else multiAgentEnabledByProject[projectPath] = enabled
  const result = await api.updateSettings({ multiAgentEnabledByProject })
  if (!result.ok) throw new Error(result.error)
  set((state) => ({ settings: { ...state.settings, multiAgentEnabledByProject } }))
}

async function setProjectParentConcurrencyLimit(
  projectPath: string,
  limit: number | null,
  set: PreferencesSet,
  get: PreferencesGet,
) {
  const { settings } = get()
  const sessionHostParentConcurrencyLimitsByProject = {
    ...settings.sessionHostParentConcurrencyLimitsByProject,
  }
  if (limit === null) delete sessionHostParentConcurrencyLimitsByProject[projectPath]
  else sessionHostParentConcurrencyLimitsByProject[projectPath] = limit
  const result = await api.updateSettings({ sessionHostParentConcurrencyLimitsByProject })
  if (!result.ok) throw new Error(result.error)
  set((state) => ({ settings: { ...state.settings, sessionHostParentConcurrencyLimitsByProject } }))
}

export function createProjectHivePreferencesActions(
  set: PreferencesSet,
  get: PreferencesGet,
): Pick<PreferencesActions, 'setProjectMultiAgentEnabled' | 'setProjectParentConcurrencyLimit'> {
  return {
    setProjectMultiAgentEnabled: (path, enabled) =>
      setProjectMultiAgentEnabled(path, enabled, set, get),
    setProjectParentConcurrencyLimit: (path, limit) =>
      setProjectParentConcurrencyLimit(path, limit, set, get),
  }
}
