import { Notification } from 'electron'
import { isAutomationMode } from '../../desktop-automation-policy'
import type { SystemNotificationsShape } from '../../ports/desktop-shell/system-notifications'

function isSupported() {
  return !isAutomationMode() && Notification.isSupported()
}

export const electronSystemNotifications: SystemNotificationsShape = {
  isSupported,
  show: (request, handlers = {}) => {
    if (!isSupported()) return null
    const notification = new Notification({
      id: request.id,
      groupId: request.groupId,
      title: request.title,
      body: request.body,
      silent: request.silent,
      ...(request.requireInteraction ? { timeoutType: 'never' as const } : {}),
    })
    if (handlers.onClick) notification.on('click', handlers.onClick)
    if (handlers.onShow) notification.on('show', handlers.onShow)
    if (handlers.onFailed) {
      const onFailed = handlers.onFailed
      notification.on('failed', (_event, error) => onFailed(error))
    }
    notification.show()
    return notification
  },
  removeDelivered: (id) => {
    if (isAutomationMode() || process.platform !== 'darwin') return
    Notification.remove(id)
  },
}
