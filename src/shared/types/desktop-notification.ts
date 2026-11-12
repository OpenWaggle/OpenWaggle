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
export type DesktopNotificationCategory = (typeof DESKTOP_NOTIFICATION_CATEGORIES)[number]

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
export type DesktopNotificationReason = (typeof DESKTOP_NOTIFICATION_REASONS)[number]

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
export type NotificationSoundId = (typeof NOTIFICATION_SOUND_IDS)[number]

/** The sounds the app synthesizes itself; `system` and `none` are not played by the app. */
export type BundledNotificationSoundId = Exclude<NotificationSoundId, 'system' | 'none'>

export function isBundledNotificationSound(
  sound: NotificationSoundId,
): sound is BundledNotificationSoundId {
  return sound !== 'system' && sound !== 'none'
}

/** What a Desktop notification does while an OpenWaggle window is focused (another Session). */
export const DESKTOP_NOTIFICATION_FOCUSED_BEHAVIORS = ['sound-only', 'show', 'nothing'] as const
export type DesktopNotificationFocusedBehavior =
  (typeof DESKTOP_NOTIFICATION_FOCUSED_BEHAVIORS)[number]

export type DesktopNotificationCategorySwitches = Readonly<
  Record<DesktopNotificationCategory, boolean>
>
export type DesktopNotificationCategorySounds = Readonly<
  Record<DesktopNotificationCategory, NotificationSoundId>
>

/** Settings → Notifications, one app-wide value the Session Host and the desktop app both read. */
export interface DesktopNotificationSettings {
  /** The master switch. */
  readonly enabled: boolean
  readonly categories: DesktopNotificationCategorySwitches
  readonly sounds: DesktopNotificationCategorySounds
  readonly whileFocused: DesktopNotificationFocusedBehavior
  readonly showBadge: boolean
  /** Adds a line of the reply, request, question or error; off by default. */
  readonly showPreviews: boolean
  /** Notification mutes: silence everything but Needs you for these projects and Sessions. */
  readonly mutedProjectPaths: readonly string[]
  readonly mutedSessionIds: readonly string[]
  /** OpenWaggle asked the operating system once, at the first Run started in the app. */
  readonly permissionRequested: boolean
  /** The one-time notice that says where these settings live was shown. */
  readonly introductionShown: boolean
  /** The one-time notice that the operating system blocks notifications was shown. */
  readonly blockedNoticeShown: boolean
}

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

/**
 * What a Desktop notification is about. Almost always one Session; a Launch schedule that needs
 * attention has no Session, so its notification belongs to the Scheduled task.
 */
export type DesktopNotificationTarget =
  | { readonly kind: 'session'; readonly sessionId: string }
  | { readonly kind: 'scheduled-task'; readonly taskId: string }

export interface DesktopNotification {
  /** One per target: a newer notification for the same target replaces the older one. */
  readonly id: string
  /** Distinguishes each notification shown under `id`, so a replay never shows one twice. */
  readonly revision: number
  readonly target: DesktopNotificationTarget
  readonly category: DesktopNotificationCategory
  readonly reason: DesktopNotificationReason
  /** The Session (or task) title, its project and, for a Worker, its parent. */
  readonly title: string
  readonly body: string
  /** Only when the person turned previews on. */
  readonly preview?: string | undefined
  readonly createdAt: number
  /**
   * Who shows it: the desktop app while it is connected, or the Session Host when no desktop app
   * was connected. A notification the Host showed is only counted by the desktop app.
   */
  readonly presentedBy: 'desktop' | 'host'
}

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
