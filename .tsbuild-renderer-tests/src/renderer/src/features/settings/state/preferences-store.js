import { DEFAULT_SETTINGS } from '@shared/types/settings';
import { create } from 'zustand';
import { createPreferencesActions } from './preferences-store-actions';
export const usePreferencesStore = create((set, get) => ({
    settings: DEFAULT_SETTINGS,
    isLoaded: false,
    loadError: null,
    ...createPreferencesActions(set, get),
}));
