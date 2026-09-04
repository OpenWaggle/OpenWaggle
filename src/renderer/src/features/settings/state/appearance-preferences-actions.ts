import type {
  AppearanceMotionPreference,
  AppearanceTypographyPreferences,
} from '@shared/types/appearance-preferences'
import type { Settings } from '@shared/types/settings'
import { setRuntimeAppearancePreferences } from '@/shared/lib/appearance-preferences-runtime'
import { api } from '@/shared/lib/ipc'
import type { PreferencesGet, PreferencesSet } from './preferences-store-types'

let appearancePreferenceWriteQueue = Promise.resolve()

function assertSettingsUpdateSucceeded(result: Awaited<ReturnType<typeof api.updateSettings>>) {
  if (!result.ok) throw new Error(result.error)
}

function queueAppearancePreferencesWrite(
  appearancePreferences: Settings['appearancePreferences'],
  set: PreferencesSet,
) {
  const write = appearancePreferenceWriteQueue
    .catch(() => undefined)
    .then(async () => {
      assertSettingsUpdateSucceeded(await api.updateSettings({ appearancePreferences }))
      set({ persistedAppearancePreferences: appearancePreferences })
    })
  appearancePreferenceWriteQueue = write
  return write
}

function persistOptimisticAppearance(
  appearancePreferences: Settings['appearancePreferences'],
  set: PreferencesSet,
  get: PreferencesGet,
) {
  setRuntimeAppearancePreferences(appearancePreferences)
  set({ settings: { ...get().settings, appearancePreferences } })
  return queueAppearancePreferencesWrite(appearancePreferences, set).catch((error: unknown) => {
    if (get().settings.appearancePreferences === appearancePreferences) {
      const persistedPreferences = get().persistedAppearancePreferences
      setRuntimeAppearancePreferences(persistedPreferences)
      set({ settings: { ...get().settings, appearancePreferences: persistedPreferences } })
    }
    throw error
  })
}

export function persistAppearanceTypography(
  typographyPatch: Partial<AppearanceTypographyPreferences>,
  set: PreferencesSet,
  get: PreferencesGet,
) {
  const current = get().settings.appearancePreferences
  return persistOptimisticAppearance(
    { ...current, typography: { ...current.typography, ...typographyPatch } },
    set,
    get,
  )
}

export function persistAppearanceMotion(
  motion: AppearanceMotionPreference,
  set: PreferencesSet,
  get: PreferencesGet,
) {
  return persistOptimisticAppearance({ ...get().settings.appearancePreferences, motion }, set, get)
}
