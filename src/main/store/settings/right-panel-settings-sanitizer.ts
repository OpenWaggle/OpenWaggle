import { DEFAULT_SETTINGS } from '@shared/types/settings'

/** Whether the Panel rail stays visible while the Right panel is closed (ADR 0043). */
export function resolveRightPanelRailVisibleWhenClosed(raw: unknown) {
  if (typeof raw === 'boolean') return raw
  // Persisted as a string by the key-value store.
  if (raw === 'true') return true
  if (raw === 'false') return false
  return DEFAULT_SETTINGS.rightPanelRailVisibleWhenClosed
}
