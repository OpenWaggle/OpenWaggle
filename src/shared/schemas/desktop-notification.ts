import { Schema } from '@shared/schema'
import {
  DESKTOP_NOTIFICATION_CATEGORIES,
  DESKTOP_NOTIFICATION_FOCUSED_BEHAVIORS,
  DESKTOP_NOTIFICATION_MUTE_LIMIT,
  DESKTOP_NOTIFICATION_REASONS,
  NOTIFICATION_SOUND_IDS,
} from '@shared/types/desktop-notification'

/** The single source of the Desktop notification types in `@shared/types/desktop-notification`. */

const MAX_MUTE_KEY_LENGTH = 4096

export const desktopNotificationCategorySchema = Schema.Literal(...DESKTOP_NOTIFICATION_CATEGORIES)
export const desktopNotificationReasonSchema = Schema.Literal(...DESKTOP_NOTIFICATION_REASONS)
export const notificationSoundSchema = Schema.Literal(...NOTIFICATION_SOUND_IDS)
export const desktopNotificationFocusedBehaviorSchema = Schema.Literal(
  ...DESKTOP_NOTIFICATION_FOCUSED_BEHAVIORS,
)

/** One value per Desktop notification category. */
function perCategory<V extends Schema.Schema.Any>(value: V) {
  return Schema.Struct({
    'needs-you': value,
    'ready-to-read': value,
    'failed-or-interrupted': value,
    'agent-errors': value,
  })
}

export const desktopNotificationCategorySwitchesSchema = perCategory(Schema.Boolean)
export const desktopNotificationCategorySoundsSchema = perCategory(notificationSoundSchema)

const muteListSchema = Schema.Array(
  Schema.String.pipe(Schema.minLength(1), Schema.maxLength(MAX_MUTE_KEY_LENGTH)),
).pipe(Schema.maxItems(DESKTOP_NOTIFICATION_MUTE_LIMIT))

/** A Session identity the renderer reports for the focus rule. */
export const desktopNotificationSessionIdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(MAX_MUTE_KEY_LENGTH),
)

/**
 * The saved Settings → Notifications value, one app-wide value the Session Host and the desktop
 * app both read. A value that does not decode is refused.
 */
export const desktopNotificationSettingsSchema = Schema.Struct({
  /** The master switch. */
  enabled: Schema.Boolean,
  categories: desktopNotificationCategorySwitchesSchema,
  sounds: desktopNotificationCategorySoundsSchema,
  whileFocused: desktopNotificationFocusedBehaviorSchema,
  showBadge: Schema.Boolean,
  /** Adds a line of the reply, request, question or error; off by default. */
  showPreviews: Schema.Boolean,
  /** Notification mutes: silence everything but Needs you for these projects and Sessions. */
  mutedProjectPaths: muteListSchema,
  mutedSessionIds: muteListSchema,
  /** OpenWaggle asked the operating system once, at the first Run started in the app. */
  permissionRequested: Schema.Boolean,
  /** The one-time notice that says where these settings live was shown. */
  introductionShown: Schema.Boolean,
  /** The one-time notice that the operating system blocks notifications was shown. */
  blockedNoticeShown: Schema.Boolean,
})

const MAX_NOTIFICATION_TEXT_LENGTH = 1024
const MAX_NOTIFICATION_ID_LENGTH = 512

const notificationTextSchema = Schema.String.pipe(Schema.maxLength(MAX_NOTIFICATION_TEXT_LENGTH))
const notificationIdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(MAX_NOTIFICATION_ID_LENGTH),
)

/**
 * What a Desktop notification is about. Almost always one Session; a Launch schedule that needs
 * attention has no Session, so its notification belongs to the Scheduled task.
 */
export const desktopNotificationTargetSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal('session'), sessionId: notificationIdSchema }),
  Schema.Struct({ kind: Schema.Literal('scheduled-task'), taskId: notificationIdSchema }),
)

/** A Desktop notification as the Session Host publishes and lists it. */
export const desktopNotificationSchema = Schema.Struct({
  /** One per target: a newer notification for the same target replaces the older one. */
  id: notificationIdSchema,
  /** Distinguishes each notification shown under `id`, so a replay never shows one twice. */
  revision: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  target: desktopNotificationTargetSchema,
  category: desktopNotificationCategorySchema,
  reason: desktopNotificationReasonSchema,
  /** The Session (or task) title, its project and, for a Worker, its parent. */
  title: notificationTextSchema,
  body: notificationTextSchema,
  /** Only when the person turned previews on. */
  preview: Schema.optionalWith(notificationTextSchema, { exact: true }),
  createdAt: Schema.Number,
  /**
   * Who shows it: the desktop app while it is connected, or the Session Host when no desktop app
   * was connected. A notification the Host showed is only counted by the desktop app.
   */
  presentedBy: Schema.Literal('desktop', 'host'),
})

export const desktopNotificationListSchema = Schema.Array(desktopNotificationSchema)
