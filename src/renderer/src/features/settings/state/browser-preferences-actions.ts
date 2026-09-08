import type { Settings } from '@shared/types/settings'
import { api } from '@/shared/lib/ipc'
import type { PreferencesActions, PreferencesSet } from './preferences-store-types'

type BrowserAndScalarActions = Pick<
  PreferencesActions,
  | 'setDefaultAuthorizationMode'
  | 'setDefaultSessionEnvironmentMode'
  | 'setDiffSyntaxTheme'
  | 'setDiffView'
  | 'setDiffWrapLines'
  | 'setBrowserLinkTarget'
  | 'setBrowserProfiles'
  | 'setBrowserDefaultProfileId'
  | 'setBrowserDefaultViewport'
  | 'setBrowserDefaultZoomFactor'
  | 'setBrowserDefaultAppearance'
  | 'setBrowserRecordingFrameRate'
  | 'setBrowserAutoShowFloatingPreview'
  | 'setEnableAgentBrowserAccess'
>

function mergeSettings(set: PreferencesSet, patch: Partial<Settings>) {
  set((state) => ({ settings: { ...state.settings, ...patch } }))
}

function assertSettingsUpdateSucceeded(result: Awaited<ReturnType<typeof api.updateSettings>>) {
  if (!result.ok) throw new Error(result.error)
}

async function persistSetting<K extends keyof Settings>(
  key: K,
  value: Settings[K],
  set: PreferencesSet,
) {
  assertSettingsUpdateSucceeded(await api.updateSettings({ [key]: value }))
  mergeSettings(set, { [key]: value })
}

async function persistBrowserProfiles(profiles: Settings['browserProfiles'], set: PreferencesSet) {
  assertSettingsUpdateSucceeded(await api.updateSettings({ browserProfiles: profiles }))
  const persisted = await api.getSettings()
  mergeSettings(set, {
    browserProfiles: persisted.browserProfiles,
    browserDefaultProfileId: persisted.browserDefaultProfileId,
  })
}

export function createBrowserAndScalarPreferencesActions(
  set: PreferencesSet,
): BrowserAndScalarActions {
  return {
    setDefaultAuthorizationMode: (value) => persistSetting('defaultAuthorizationMode', value, set),
    setDefaultSessionEnvironmentMode: (value) =>
      persistSetting('defaultSessionEnvironmentMode', value, set),
    setDiffSyntaxTheme: (value) => persistSetting('diffSyntaxTheme', value, set),
    setDiffView: (value) => persistSetting('diffView', value, set),
    setDiffWrapLines: (value) => persistSetting('diffWrapLines', value, set),
    setBrowserLinkTarget: (value) => persistSetting('browserLinkTarget', value, set),
    setBrowserProfiles: (profiles) => persistBrowserProfiles(profiles, set),
    setBrowserDefaultProfileId: (value) => persistSetting('browserDefaultProfileId', value, set),
    setBrowserDefaultViewport: (value) => persistSetting('browserDefaultViewport', value, set),
    setBrowserDefaultZoomFactor: (value) => persistSetting('browserDefaultZoomFactor', value, set),
    setBrowserDefaultAppearance: (value) => persistSetting('browserDefaultAppearance', value, set),
    setBrowserRecordingFrameRate: (value) =>
      persistSetting('browserRecordingFrameRate', value, set),
    setBrowserAutoShowFloatingPreview: (value) =>
      persistSetting('browserAutoShowFloatingPreview', value, set),
    setEnableAgentBrowserAccess: (value) => persistSetting('enableAgentBrowserAccess', value, set),
  }
}
