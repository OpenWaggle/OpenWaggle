import type { SchemaType } from '@shared/schema'
import type {
  desktopNotificationCategorySchema,
  desktopNotificationFocusedBehaviorSchema,
  desktopNotificationReasonSchema,
  desktopNotificationSchema,
  desktopNotificationSettingsSchema,
  desktopNotificationTargetSchema,
  notificationSoundSchema,
} from '@shared/schemas/desktop-notification'

/**
 * Desktop notifications (CONTEXT.md, ADR 0062): operating-system notifications that tell the
 * person a Session needs them or has something to read. The Session Host decides when one is
 * due; the desktop app shows it while connected, and the Host shows it itself otherwise.
 */

/** The four kinds of event a person can turn Desktop notifications on or off for. */
export const DESKTOP_NOTIFICATION_CATEGORIES = [
  'needs-you',
  'ready-to-read',
  'failed-or-interrupted',
  'agent-errors',
] as const
export type DesktopNotificationCategory = SchemaType<typeof desktopNotificationCategorySchema>

/** What happened, worded in the app's own terms by `desktopNotificationBody`. */
export const DESKTOP_NOTIFICATION_REASONS = [
  'awaiting-approval',
  'awaiting-answer',
  'stuck',
  'completed',
  'failed',
  'interaction-timeout',
  'host-loss',
  'agent-error',
  'scheduled-task-attention',
] as const
export type DesktopNotificationReason = SchemaType<typeof desktopNotificationReasonSchema>

/** OpenWaggle's bundled sounds, plus the operating system's default and silence. */
export const NOTIFICATION_SOUND_IDS = [
  'chime',
  'bell',
  'pop',
  'glass',
  'pulse',
  'low-tone',
  'system',
  'none',
] as const
export type NotificationSoundId = SchemaType<typeof notificationSoundSchema>

/** The sounds the app synthesizes itself; `system` and `none` are not played by the app. */
export type BundledNotificationSoundId = Exclude<NotificationSoundId, 'system' | 'none'>

export function isBundledNotificationSound(
  sound: NotificationSoundId,
): sound is BundledNotificationSoundId {
  return sound !== 'system' && sound !== 'none'
}

/** What a Desktop notification does while an OpenWaggle window is focused (another Session). */
export const DESKTOP_NOTIFICATION_FOCUSED_BEHAVIORS = ['sound-only', 'show', 'nothing'] as const
export type DesktopNotificationFocusedBehavior = SchemaType<
  typeof desktopNotificationFocusedBehaviorSchema
>

/** Settings → Notifications, one app-wide value the Session Host and the desktop app both read. */
export type DesktopNotificationSettings = SchemaType<typeof desktopNotificationSettingsSchema>

export const DEFAULT_DESKTOP_NOTIFICATION_SETTINGS: DesktopNotificationSettings = {
  enabled: true,
  categories: {
    'needs-you': true,
    'ready-to-read': true,
    'failed-or-interrupted': true,
    'agent-errors': true,
  },
  sounds: {
    'needs-you': 'chime',
    'ready-to-read': 'pop',
    'failed-or-interrupted': 'low-tone',
    'agent-errors': 'low-tone',
  },
  whileFocused: 'sound-only',
  showBadge: true,
  showPreviews: false,
  mutedProjectPaths: [],
  mutedSessionIds: [],
  permissionRequested: false,
  introductionShown: false,
  blockedNoticeShown: false,
}

/** How many projects and Sessions a person can mute; more are refused, not truncated. */
export const DESKTOP_NOTIFICATION_MUTE_LIMIT = 2000

export type DesktopNotificationTarget = SchemaType<typeof desktopNotificationTargetSchema>
export type DesktopNotification = SchemaType<typeof desktopNotificationSchema>

export function desktopNotificationIdFor(target: DesktopNotificationTarget) {
  return target.kind === 'session'
    ? `session:${target.sessionId}`
    : `scheduled-task:${target.taskId}`
}

/** A Needs you notification is never displaced by a later, less urgent one while it stands. */
export const DESKTOP_NOTIFICATION_CATEGORY_PRIORITY: Readonly<
  Record<DesktopNotificationCategory, number>
> = {
  'needs-you': 3,
  'failed-or-interrupted': 2,
  'agent-errors': 1,
  'ready-to-read': 0,
}

/** What the operating system lets OpenWaggle show, as far as the desktop app can tell. */
export type DesktopNotificationPermissionStatus =
  | 'not-asked'
  | 'allowed'
  | 'blocked'
  | 'unsupported'
