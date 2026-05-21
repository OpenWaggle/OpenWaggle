import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { create } from 'zustand'
import { createPreferencesActions } from './preferences-store-actions'
import type { PreferencesState } from './preferences-store-types'

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  isLoaded: false,
  loadError: null,
  ...createPreferencesActions(set, get),
}))
