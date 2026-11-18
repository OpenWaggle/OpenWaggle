import type {
  DesktopNotification,
  DesktopNotificationPermissionStatus,
} from './desktop-notification'

/** Desktop notifications (ADR 0062): the Host's outstanding list and the desktop app's controls. */
export interface IpcDesktopNotificationsInvokeChannelMap {
  /** The Desktop notifications still outstanding, as the Session Host holds them. */
  'desktop-notifications:list': {
    args: []
    return: readonly DesktopNotification[]
  }
  /** What the operating system lets OpenWaggle show, as far as the app can tell. */
  'desktop-notifications:get-permission-status': {
    args: []
    return: DesktopNotificationPermissionStatus
  }
  /**
   * Asks the operating system once, at the first Run the person starts in the app. Later calls
   * only report the status.
   */
  'desktop-notifications:request-permission': {
    args: []
    return: DesktopNotificationPermissionStatus
  }
  /** Shows a sample Desktop notification with the Needs you sound. */
  'desktop-notifications:send-test': {
    args: []
    return: DesktopNotificationPermissionStatus
  }
  /** Opens the operating system's notification settings for OpenWaggle. */
  'desktop-notifications:open-system-settings': {
    args: []
    return: undefined
  }
}
