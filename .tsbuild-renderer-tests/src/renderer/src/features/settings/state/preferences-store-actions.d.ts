import type { PreferencesActions, PreferencesState } from './preferences-store-types';
type PreferencesSet = (partial: Partial<PreferencesState> | ((state: PreferencesState) => Partial<PreferencesState>)) => void;
type PreferencesGet = () => PreferencesState;
export declare function createPreferencesActions(set: PreferencesSet, get: PreferencesGet): PreferencesActions;
export {};
