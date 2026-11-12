import type { IpcEventMethod, IpcInvokeMethod, IpcSendMethod } from './ipc-api-methods'

/** Renderer-facing Desktop notifications API (ADR 0062). */
export interface OpenWaggleDesktopNotificationsApi {
  getDesktopNotificationPermissionStatus: IpcInvokeMethod<'desktop-notifications:get-permission-status'>
  requestDesktopNotificationPermission: IpcInvokeMethod<'desktop-notifications:request-permission'>
  sendTestDesktopNotification: IpcInvokeMethod<'desktop-notifications:send-test'>
  openDesktopNotificationSystemSettings: IpcInvokeMethod<'desktop-notifications:open-system-settings'>
  /** Tell the desktop app which Session this window shows, or `null`. */
  setDesktopNotificationViewingSession: IpcSendMethod<'desktop-notifications:set-viewing-session'>
  /** The desktop app asks the focused window to play a Notification sound. */
  onDesktopNotificationSound: IpcEventMethod<'desktop-notifications:play-sound'>
  /** The permission status changed, for instance a notification was refused by the system. */
  onDesktopNotificationPermissionChanged: IpcEventMethod<'desktop-notifications:permission-changed'>
  /** A notification about a Launch schedule was clicked: open that Scheduled task. */
  onDesktopNotificationOpenScheduledTask: IpcEventMethod<'desktop-notifications:open-scheduled-task'>
}
