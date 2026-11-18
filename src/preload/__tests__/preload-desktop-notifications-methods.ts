import type { OpenWaggleApi } from '@shared/types/openwaggle-api'

/** The Desktop notification methods of the preload bridge (ADR 0062). */
export const PRELOAD_DESKTOP_NOTIFICATIONS_METHODS = [
  'getDesktopNotificationPermissionStatus',
  'requestDesktopNotificationPermission',
  'sendTestDesktopNotification',
  'openDesktopNotificationSystemSettings',
  'setDesktopNotificationViewingSession',
  'onDesktopNotificationSound',
  'onDesktopNotificationPermissionChanged',
  'onDesktopNotificationOpenScheduledTask',
] as const satisfies readonly (keyof OpenWaggleApi)[]
