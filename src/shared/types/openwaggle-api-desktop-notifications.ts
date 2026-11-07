import type {
  BundledNotificationSoundId,
  DesktopNotificationPermissionStatus,
} from './desktop-notification'

/** Renderer-facing Desktop notifications API (ADR 0062). */
export interface OpenWaggleDesktopNotificationsApi {
  getDesktopNotificationPermissionStatus(): Promise<DesktopNotificationPermissionStatus>
  requestDesktopNotificationPermission(): Promise<DesktopNotificationPermissionStatus>
  sendTestDesktopNotification(): Promise<DesktopNotificationPermissionStatus>
  openDesktopNotificationSystemSettings(): Promise<undefined>
  /** Tell the desktop app which Session this window shows, or `null`. */
  setDesktopNotificationViewingSession(sessionId: string | null): void
  /** The desktop app asks the focused window to play a Notification sound. */
  onDesktopNotificationSound(
    callback: (payload: { readonly sound: BundledNotificationSoundId }) => void,
  ): () => void
  /** The permission status changed, for instance a notification was refused by the system. */
  onDesktopNotificationPermissionChanged(
    callback: (payload: DesktopNotificationPermissionStatus) => void,
  ): () => void
  /** A notification about a Launch schedule was clicked: open that Scheduled task. */
  onDesktopNotificationOpenScheduledTask(
    callback: (payload: { readonly taskId: string }) => void,
  ): () => void
}
