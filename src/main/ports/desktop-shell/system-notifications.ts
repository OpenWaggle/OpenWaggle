import { Context } from 'effect'

export interface SystemNotificationRequest {
  /** Replaces a delivered notification with the same id (macOS, Windows). */
  readonly id: string
  readonly groupId: string
  readonly title: string
  readonly body: string
  /** Suppress the operating system's own sound. */
  readonly silent: boolean
  /** Keep it on screen until clicked (Windows drops clicks once it moves to the Action Center). */
  readonly requireInteraction?: boolean
}

export interface SystemNotificationHandlers {
  readonly onClick?: () => void
  readonly onShow?: () => void
  /** The system refused it, for example because notifications are off for the app. */
  readonly onFailed?: (error: string) => void
}

/** A notification this process showed. */
export interface SystemNotificationHandle {
  readonly close: () => void
}

/**
 * Operating-system notifications (ADR 0062, ADR 0064). Nothing is shown during non-disruptive
 * automation: `isSupported()` is false and `show` returns `null` there.
 */
export interface SystemNotificationsShape {
  readonly isSupported: () => boolean
  /** Shows one notification, or returns `null` when the system cannot show any. */
  readonly show: (
    request: SystemNotificationRequest,
    handlers?: SystemNotificationHandlers,
  ) => SystemNotificationHandle | null
  /** Removes a delivered notification from Notification Center (macOS keeps it otherwise). */
  readonly removeDelivered: (id: string) => void
}

export class SystemNotifications extends Context.Tag('@openwaggle/SystemNotifications')<
  SystemNotifications,
  SystemNotificationsShape
>() {}
