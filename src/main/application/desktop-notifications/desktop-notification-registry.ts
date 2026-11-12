import type { DesktopNotification } from '@shared/types/desktop-notification'

interface DesktopNotificationList {
  readonly list: () => readonly DesktopNotification[]
}

let installed: DesktopNotificationList | null = null

/** The running observer's outstanding notifications, for `desktop-notifications:list`. */
export function listOutstandingDesktopNotifications() {
  const notification: readonly DesktopNotification[] = installed?.list() ?? []
  return notification
}

export function installDesktopNotificationList(list: DesktopNotificationList) {
  installed = list
  return () => {
    if (installed === list) installed = null
  }
}
