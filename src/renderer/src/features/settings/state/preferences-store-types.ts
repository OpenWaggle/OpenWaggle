import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import type { SupportedModelId } from '@shared/types/brand'
import type { SessionEnvironmentMode } from '@shared/types/git'
import type { DiffSyntaxTheme, DiffView, Settings, ThinkingLevel } from '@shared/types/settings'
import type { ShortcutBinding, ShortcutCommand } from '@shared/types/shortcuts'

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
  setDefaultAuthorizationMode: (mode: AgentAuthorizationMode) => Promise<void>
  setDefaultSessionEnvironmentMode: (mode: SessionEnvironmentMode) => Promise<void>
  setDiffSyntaxTheme: (theme: DiffSyntaxTheme) => Promise<void>
  setDiffView: (view: DiffView) => Promise<void>
  setDiffWrapLines: (wrap: boolean) => Promise<void>
  setEnabledModels: (models: string[]) => Promise<void>
  setProjectDisplayName: (path: string, name: string) => Promise<void>
  setShortcutBinding: (command: ShortcutCommand, binding: ShortcutBinding | null) => Promise<void>
  resetShortcutBindings: () => Promise<void>
  clearProjectDisplayName: (path: string) => Promise<void>
  removeProjectReferences: (path: string) => Promise<void>
  loadProjectPreferences: (projectPath: string) => Promise<void>
}

export type PreferencesActions = Omit<PreferencesState, 'settings' | 'isLoaded' | 'loadError'>
