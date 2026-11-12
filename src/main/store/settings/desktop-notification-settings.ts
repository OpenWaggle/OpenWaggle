/**
 * The global `desktopNotifications` Setting (ADR 0062): on by default. A present value that does
 * not decode is refused by persisted-settings validation rather than read as the defaults; each
 * field is still read on its own here, so a patch never loses a field it did not name.
 */
import { Schema } from '@shared/schema'
import {
  desktopNotificationFocusedBehaviorSchema,
  desktopNotificationSettingsSchema,
  notificationSoundSchema,
} from '@shared/schemas/desktop-notification'
import { lenientResolved, lenientWithFallback } from '@shared/schemas/lenient-exact'
import {
  DEFAULT_DESKTOP_NOTIFICATION_SETTINGS,
  DESKTOP_NOTIFICATION_MUTE_LIMIT,
  type DesktopNotificationCategory,
  type DesktopNotificationSettings,
} from '@shared/types/desktop-notification'
import type { Settings } from '@shared/types/settings'
import { Option } from 'effect'
import { SETTINGS_KEY_DESKTOP_NOTIFICATIONS } from './keys'
import { appendChangedSetting, type SettingsPatchWrite } from './settings-patch-writes'

const DEFAULTS = DEFAULT_DESKTOP_NOTIFICATION_SETTINGS

function booleanOr(fallback: boolean) {
  return lenientWithFallback(Schema.Boolean, () => fallback)
}

/** Each category's value when it decodes, else that category's default. */
function perCategory<A, I>(
  value: Schema.Schema<A, I>,
  fallback: Readonly<Record<DesktopNotificationCategory, NoInfer<A>>>,
) {
  const decode = Schema.decodeUnknownOption(
    Schema.Struct({
      'needs-you': lenientWithFallback(value, () => fallback['needs-you']),
      'ready-to-read': lenientWithFallback(value, () => fallback['ready-to-read']),
      'failed-or-interrupted': lenientWithFallback(value, () => fallback['failed-or-interrupted']),
      'agent-errors': lenientWithFallback(value, () => fallback['agent-errors']),
    }),
  )
  return (raw: unknown) => Option.getOrElse(decode(raw), () => fallback)
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

const fields = desktopNotificationSettingsSchema.fields

const decodeStoredDesktopNotificationSettings = Schema.decodeUnknownOption(
  Schema.Struct({
    enabled: booleanOr(DEFAULTS.enabled),
    categories: lenientResolved(
      fields.categories,
      perCategory(Schema.Boolean, DEFAULTS.categories),
    ),
    sounds: lenientResolved(fields.sounds, perCategory(notificationSoundSchema, DEFAULTS.sounds)),
    whileFocused: lenientWithFallback(
      desktopNotificationFocusedBehaviorSchema,
      () => DEFAULTS.whileFocused,
    ),
    showBadge: booleanOr(DEFAULTS.showBadge),
    showPreviews: booleanOr(DEFAULTS.showPreviews),
    mutedProjectPaths: lenientResolved(fields.mutedProjectPaths, muteList),
    mutedSessionIds: lenientResolved(fields.mutedSessionIds, muteList),
    permissionRequested: booleanOr(DEFAULTS.permissionRequested),
    introductionShown: booleanOr(DEFAULTS.introductionShown),
    blockedNoticeShown: booleanOr(DEFAULTS.blockedNoticeShown),
  }),
)

export function resolveDesktopNotificationSettings(value: unknown): DesktopNotificationSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return DEFAULTS
  return Option.getOrElse(decodeStoredDesktopNotificationSettings(value), () => DEFAULTS)
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
