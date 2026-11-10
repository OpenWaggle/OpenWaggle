import type { DesktopNotification } from '@shared/types/desktop-notification'
import { sessionLink } from '@shared/utils/session-link'
import * as Layer from 'effect/Layer'
import {
  launchExternalApplication,
  removeDeliveredNativeNotification,
  showNativeNotification,
} from '../desktop-ui'
import { describeError } from '../error-description'
import { createLogger } from '../logger'
import { DesktopNotificationHostPresenter } from '../ports/desktop-notification-host-presenter'
import type { SystemNotificationHandle } from '../ports/desktop-shell/system-notifications'
import { desktopAppLaunchArguments, desktopAppOpenArguments } from '../session-link-forwarding'

const logger = createLogger('desktop-notifications/host')

/** The notification text: what happened, then the preview line when there is one. */
export function nativeNotificationBody(notification: DesktopNotification) {
  return notification.preview ? `${notification.body}\n${notification.preview}` : notification.body
}

/**
 * Start the desktop app on the notification's Session. The app opens it, or hands it to the
 * running app through the single-instance lock (ADR 0056).
 */
function openDesktopApp(notification: DesktopNotification) {
  const link =
    notification.target.kind === 'session' ? sessionLink(notification.target.sessionId) : null
  const launch =
    process.platform === 'darwin'
      ? launchExternalApplication(
          'open',
          link
            ? desktopAppLaunchArguments(process.execPath, link)
            : desktopAppOpenArguments(process.execPath),
        )
      : launchExternalApplication(process.execPath, link ? [link] : [])
  void launch.catch((error: unknown) => {
    logger.warn('Could not open the desktop app from a notification', describeError(error))
  })
}

function makeHostPresenter() {
  const shown = new Map<string, SystemNotificationHandle>()
  return {
    show: (notification: DesktopNotification, sound: 'system' | 'none') => {
      shown.get(notification.id)?.close()
      const native = showNativeNotification(
        {
          id: notification.id,
          groupId: notification.id,
          title: notification.title,
          body: nativeNotificationBody(notification),
          silent: sound === 'none',
          requireInteraction: process.platform === 'win32',
        },
        {
          onClick: () => {
            shown.get(notification.id)?.close()
            shown.delete(notification.id)
            openDesktopApp(notification)
          },
          onFailed: (error) => logger.warn('The system refused a notification', { error }),
        },
      )
      if (native) shown.set(notification.id, native)
      else shown.delete(notification.id)
    },
    withdraw: (notificationId: string) => {
      shown.get(notificationId)?.close()
      shown.delete(notificationId)
      removeDeliveredNativeNotification(notificationId)
    },
  }
}

/** The Session Host's own notifications, when no desktop app is connected (ADR 0062). */
export const ElectronDesktopNotificationHostPresenterLive = Layer.sync(
  DesktopNotificationHostPresenter,
  makeHostPresenter,
)
