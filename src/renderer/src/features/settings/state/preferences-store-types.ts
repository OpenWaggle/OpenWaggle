import type { SupportedModelId } from '@shared/types/brand'
import type { Settings, ThinkingLevel } from '@shared/types/settings'

export interface PreferencesState {
  settings: Settings
  isLoaded: boolean
  loadError: string | null

  loadSettings: () => Promise<void>
  retryLoad: () => Promise<void>
  setSelectedModel: (model: SupportedModelId) => Promise<void>
  toggleFavoriteModel: (model: SupportedModelId) => Promise<void>
  setProjectPath: (path: string | null) => Promise<void>
  pushRecentProject: (path: string) => Promise<void>
  removeRecentProject: (path: string) => Promise<void>
  setThinkingLevel: (preset: ThinkingLevel) => Promise<void>
  setEnabledModels: (models: string[]) => Promise<void>
  setProjectDisplayName: (path: string, name: string) => Promise<void>
  clearProjectDisplayName: (path: string) => Promise<void>
  removeProjectReferences: (path: string) => Promise<void>
  loadProjectPreferences: (projectPath: string) => Promise<void>
}

export type PreferencesActions = Omit<PreferencesState, 'settings' | 'isLoaded' | 'loadError'>
