import { Schema } from '@shared/schema'
import {
  DESKTOP_NOTIFICATION_CATEGORIES,
  DESKTOP_NOTIFICATION_FOCUSED_BEHAVIORS,
  DESKTOP_NOTIFICATION_MUTE_LIMIT,
  DESKTOP_NOTIFICATION_REASONS,
  type DesktopNotification,
  type DesktopNotificationSettings,
  type DesktopNotificationTarget,
  NOTIFICATION_SOUND_IDS,
} from '@shared/types/desktop-notification'

const MAX_MUTE_KEY_LENGTH = 4096

const notificationSoundSchema = Schema.Literal(...NOTIFICATION_SOUND_IDS)

const muteListSchema = Schema.Array(
  Schema.String.pipe(Schema.minLength(1), Schema.maxLength(MAX_MUTE_KEY_LENGTH)),
).pipe(Schema.maxItems(DESKTOP_NOTIFICATION_MUTE_LIMIT))

/** A Session identity the renderer reports for the focus rule. */
export const desktopNotificationSessionIdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(MAX_MUTE_KEY_LENGTH),
)

/** The saved Settings → Notifications value; a value that does not decode is refused. */
export const desktopNotificationSettingsSchema: Schema.Schema<DesktopNotificationSettings> =
  Schema.Struct({
    enabled: Schema.Boolean,
    categories: Schema.Struct({
      'needs-you': Schema.Boolean,
      'ready-to-read': Schema.Boolean,
      'failed-or-interrupted': Schema.Boolean,
      'agent-errors': Schema.Boolean,
    }),
    sounds: Schema.Struct({
      'needs-you': notificationSoundSchema,
      'ready-to-read': notificationSoundSchema,
      'failed-or-interrupted': notificationSoundSchema,
      'agent-errors': notificationSoundSchema,
    }),
    whileFocused: Schema.Literal(...DESKTOP_NOTIFICATION_FOCUSED_BEHAVIORS),
    showBadge: Schema.Boolean,
    showPreviews: Schema.Boolean,
    mutedProjectPaths: muteListSchema,
    mutedSessionIds: muteListSchema,
    permissionRequested: Schema.Boolean,
    introductionShown: Schema.Boolean,
    blockedNoticeShown: Schema.Boolean,
  })

const MAX_NOTIFICATION_TEXT_LENGTH = 1024
const MAX_NOTIFICATION_ID_LENGTH = 512

const notificationTextSchema = Schema.String.pipe(Schema.maxLength(MAX_NOTIFICATION_TEXT_LENGTH))
const notificationIdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(MAX_NOTIFICATION_ID_LENGTH),
)

export const desktopNotificationTargetSchema: Schema.Schema<DesktopNotificationTarget> =
  Schema.Union(
    Schema.Struct({ kind: Schema.Literal('session'), sessionId: notificationIdSchema }),
    Schema.Struct({ kind: Schema.Literal('scheduled-task'), taskId: notificationIdSchema }),
  )

/** A Desktop notification as the Session Host publishes and lists it. */
export const desktopNotificationSchema: Schema.Schema<DesktopNotification> = Schema.Struct({
  id: notificationIdSchema,
  revision: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  target: desktopNotificationTargetSchema,
  category: Schema.Literal(...DESKTOP_NOTIFICATION_CATEGORIES),
  reason: Schema.Literal(...DESKTOP_NOTIFICATION_REASONS),
  title: notificationTextSchema,
  body: notificationTextSchema,
  preview: Schema.optional(notificationTextSchema),
  createdAt: Schema.Number,
  presentedBy: Schema.Literal('desktop', 'host'),
})

export const desktopNotificationListSchema = Schema.Array(desktopNotificationSchema)
