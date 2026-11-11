import { invoke, on, send } from './transport'

/** Settings → Notifications and Notification sounds (ADR 0062). */
export const desktopNotificationsApi = {
  getDesktopNotificationPermissionStatus: invoke('desktop-notifications:get-permission-status'),
  requestDesktopNotificationPermission: invoke('desktop-notifications:request-permission'),
  sendTestDesktopNotification: invoke('desktop-notifications:send-test'),
  openDesktopNotificationSystemSettings: invoke('desktop-notifications:open-system-settings'),
  setDesktopNotificationViewingSession: send('desktop-notifications:set-viewing-session'),
  onDesktopNotificationSound: on('desktop-notifications:play-sound'),
  onDesktopNotificationPermissionChanged: on('desktop-notifications:permission-changed'),
  onDesktopNotificationOpenScheduledTask: on('desktop-notifications:open-scheduled-task'),
}
