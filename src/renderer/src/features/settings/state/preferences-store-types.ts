import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import type {
  AppearanceMotionPreference,
  AppearancePreferences,
  AppearanceTerminalPalettePreferences,
  AppearanceTypographyPreferences,
} from '@shared/types/appearance-preferences'
import type { SupportedModelId } from '@shared/types/brand'
import type {
  BrowserPreviewAppearance,
  BrowserPreviewRecordingFrameRate,
  BrowserPreviewViewport,
  BrowserPreviewZoomFactor,
} from '@shared/types/browser-preview-controls'
import type { BrowserProfile } from '@shared/types/browser-profile'
import type { SessionEnvironmentMode } from '@shared/types/git'
import type {
  BrowserLinkTarget,
  DiffSyntaxTheme,
  DiffView,
  Settings,
  ThinkingLevel,
} from '@shared/types/settings'
import type { ShortcutBinding, ShortcutCommand, ShortcutRules } from '@shared/types/shortcuts'
import type { SyntaxAppearanceVariant, SyntaxThemeId } from '@shared/types/syntax'

export interface PreferencesState {
  settings: Settings
  persistedAppearancePreferences: AppearancePreferences
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
  setSyntaxTheme: (variant: SyntaxAppearanceVariant, themeId: SyntaxThemeId) => Promise<void>
  setDiffView: (view: DiffView) => Promise<void>
  setDiffWrapLines: (wrap: boolean) => Promise<void>
  setBrowserLinkTarget: (target: BrowserLinkTarget) => Promise<void>
  setBrowserProfiles: (profiles: readonly BrowserProfile[]) => Promise<void>
  setBrowserDefaultProfileId: (profileId: string) => Promise<void>
  setBrowserDefaultViewport: (viewport: BrowserPreviewViewport) => Promise<void>
  setBrowserDefaultZoomFactor: (zoomFactor: BrowserPreviewZoomFactor) => Promise<void>
  setBrowserDefaultAppearance: (appearance: BrowserPreviewAppearance) => Promise<void>
  setBrowserRecordingFrameRate: (frameRate: BrowserPreviewRecordingFrameRate) => Promise<void>
  setBrowserAutoShowFloatingPreview: (enabled: boolean) => Promise<void>
  setEnableAgentBrowserAccess: (enabled: boolean) => Promise<void>
  setAppearanceTypography: (typography: Partial<AppearanceTypographyPreferences>) => Promise<void>
  setAppearanceTerminalPalette: (
    palette: Partial<AppearanceTerminalPalettePreferences>,
  ) => Promise<void>
  setAppearanceMotion: (motion: AppearanceMotionPreference) => Promise<void>
  setEnabledModels: (models: string[]) => Promise<void>
  setProjectDisplayName: (path: string, name: string) => Promise<void>
  setShortcutBinding: (command: ShortcutCommand, binding: ShortcutBinding | null) => Promise<void>
  setShortcutRules: (rules: ShortcutRules) => Promise<void>
  resetShortcutBindings: () => Promise<void>
  resetShortcutRules: () => Promise<void>
  clearProjectDisplayName: (path: string) => Promise<void>
  removeProjectReferences: (path: string) => Promise<void>
  loadProjectPreferences: (projectPath: string) => Promise<void>
}

export type PreferencesActions = Omit<
  PreferencesState,
  'settings' | 'persistedAppearancePreferences' | 'isLoaded' | 'loadError'
>

export type PreferencesSet = (
  partial: Partial<PreferencesState> | ((state: PreferencesState) => Partial<PreferencesState>),
) => void

export type PreferencesGet = () => PreferencesState
