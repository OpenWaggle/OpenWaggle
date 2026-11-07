/**
 * The global `desktopNotifications` Setting (ADR 0062): on by default. A present value that does
 * not decode is refused by persisted-settings validation rather than read as the defaults; each
 * field is still read on its own here, so a patch never loses a field it did not name.
 */
import {
  DEFAULT_DESKTOP_NOTIFICATION_SETTINGS,
  DESKTOP_NOTIFICATION_FOCUSED_BEHAVIORS,
  DESKTOP_NOTIFICATION_MUTE_LIMIT,
  type DesktopNotificationCategory,
  type DesktopNotificationSettings,
  NOTIFICATION_SOUND_IDS,
  type NotificationSoundId,
} from '@shared/types/desktop-notification'
import type { Settings } from '@shared/types/settings'
import { SETTINGS_KEY_DESKTOP_NOTIFICATIONS } from './keys'
import { appendChangedSetting, type SettingsPatchWrite } from './settings-patch-writes'

const DEFAULTS = DEFAULT_DESKTOP_NOTIFICATION_SETTINGS

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function booleanOr(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function soundOr(value: unknown, fallback: NotificationSoundId): NotificationSoundId {
  return NOTIFICATION_SOUND_IDS.find((sound) => sound === value) ?? fallback
}

function perCategory<V>(
  raw: unknown,
  fallback: Readonly<Record<DesktopNotificationCategory, V>>,
  read: (value: unknown, fallback: V) => V,
): Record<DesktopNotificationCategory, V> {
  const source = isRecord(raw) ? raw : {}
  return {
    'needs-you': read(source['needs-you'], fallback['needs-you']),
    'ready-to-read': read(source['ready-to-read'], fallback['ready-to-read']),
    'failed-or-interrupted': read(
      source['failed-or-interrupted'],
      fallback['failed-or-interrupted'],
    ),
    'agent-errors': read(source['agent-errors'], fallback['agent-errors']),
  }
}

/** Distinct, non-empty keys in their saved order, at most the mute limit. */
function muteList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const key = entry.trim()
    if (key) seen.add(key)
    if (seen.size >= DESKTOP_NOTIFICATION_MUTE_LIMIT) break
  }
  return [...seen]
}

export function resolveDesktopNotificationSettings(raw: unknown): DesktopNotificationSettings {
  if (!isRecord(raw)) return DEFAULTS
  return {
    enabled: booleanOr(raw.enabled, DEFAULTS.enabled),
    categories: perCategory(raw.categories, DEFAULTS.categories, booleanOr),
    sounds: perCategory(raw.sounds, DEFAULTS.sounds, soundOr),
    whileFocused:
      DESKTOP_NOTIFICATION_FOCUSED_BEHAVIORS.find((behavior) => behavior === raw.whileFocused) ??
      DEFAULTS.whileFocused,
    showBadge: booleanOr(raw.showBadge, DEFAULTS.showBadge),
    showPreviews: booleanOr(raw.showPreviews, DEFAULTS.showPreviews),
    mutedProjectPaths: muteList(raw.mutedProjectPaths),
    mutedSessionIds: muteList(raw.mutedSessionIds),
    permissionRequested: booleanOr(raw.permissionRequested, DEFAULTS.permissionRequested),
    introductionShown: booleanOr(raw.introductionShown, DEFAULTS.introductionShown),
    blockedNoticeShown: booleanOr(raw.blockedNoticeShown, DEFAULTS.blockedNoticeShown),
  }
}

export function resolveStoredDesktopNotificationSettings(
  storedSettings: Readonly<Record<string, unknown>>,
) {
  return {
    desktopNotifications: resolveDesktopNotificationSettings(
      Object.hasOwn(storedSettings, SETTINGS_KEY_DESKTOP_NOTIFICATIONS)
        ? storedSettings[SETTINGS_KEY_DESKTOP_NOTIFICATIONS]
        : undefined,
    ),
  }
}

export function resolveNextDesktopNotificationSettings(
  current: Settings,
  partial: Partial<Settings>,
) {
  return {
    desktopNotifications:
      partial.desktopNotifications === undefined
        ? current.desktopNotifications
        : resolveDesktopNotificationSettings(partial.desktopNotifications),
  }
}

export function appendDesktopNotificationSettingsWrites(
  writes: SettingsPatchWrite[],
  partial: Partial<Settings>,
  next: Settings,
) {
  appendChangedSetting(
    writes,
    partial.desktopNotifications !== undefined,
    SETTINGS_KEY_DESKTOP_NOTIFICATIONS,
    next.desktopNotifications,
  )
}
