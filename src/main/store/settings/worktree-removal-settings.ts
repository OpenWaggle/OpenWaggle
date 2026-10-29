/**
 * The global `automaticWorktreeRemoval` Setting (ADR 0060): off by default. A present value that
 * does not decode is rejected by persisted-settings validation rather than read as off.
 */
import type { Settings } from '@shared/types/settings'
import {
  type AutomaticWorktreeRemovalSettings,
  DEFAULT_AUTOMATIC_WORKTREE_REMOVAL,
  isAutomaticWorktreeRemovalDays,
} from '@shared/types/worktree-inventory'
import { SETTINGS_KEY_AUTOMATIC_WORKTREE_REMOVAL } from './keys'
import { appendChangedSetting, type SettingsPatchWrite } from './settings-patch-writes'

export function resolveAutomaticWorktreeRemoval(raw: unknown): AutomaticWorktreeRemovalSettings {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return DEFAULT_AUTOMATIC_WORKTREE_REMOVAL
  }
  const enabled = 'enabled' in raw ? raw.enabled : undefined
  const archivedDays = 'archivedDays' in raw ? raw.archivedDays : undefined
  return {
    enabled: typeof enabled === 'boolean' ? enabled : DEFAULT_AUTOMATIC_WORKTREE_REMOVAL.enabled,
    archivedDays: isAutomaticWorktreeRemovalDays(archivedDays)
      ? archivedDays
      : DEFAULT_AUTOMATIC_WORKTREE_REMOVAL.archivedDays,
  }
}

export function resolveStoredWorktreeRemovalSettings(
  storedSettings: Readonly<Record<string, unknown>>,
) {
  return {
    automaticWorktreeRemoval: resolveAutomaticWorktreeRemoval(
      Object.hasOwn(storedSettings, SETTINGS_KEY_AUTOMATIC_WORKTREE_REMOVAL)
        ? storedSettings[SETTINGS_KEY_AUTOMATIC_WORKTREE_REMOVAL]
        : undefined,
    ),
  }
}

export function resolveNextWorktreeRemovalSettings(current: Settings, partial: Partial<Settings>) {
  return {
    automaticWorktreeRemoval:
      partial.automaticWorktreeRemoval === undefined
        ? current.automaticWorktreeRemoval
        : resolveAutomaticWorktreeRemoval(partial.automaticWorktreeRemoval),
  }
}

export function appendWorktreeRemovalSettingsWrites(
  writes: SettingsPatchWrite[],
  partial: Partial<Settings>,
  next: Settings,
) {
  appendChangedSetting(
    writes,
    partial.automaticWorktreeRemoval !== undefined,
    SETTINGS_KEY_AUTOMATIC_WORKTREE_REMOVAL,
    next.automaticWorktreeRemoval,
  )
}
