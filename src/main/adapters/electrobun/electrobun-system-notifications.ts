import { isAutomationMode } from '../../desktop-automation-policy'
import type {
  SystemNotificationHandlers,
  SystemNotificationRequest,
  SystemNotificationsShape,
} from '../../ports/desktop-shell/system-notifications'
import { type ElectrobunSdk, loadedElectrobun } from './electrobun-sdk'

/**
 * Electrobun's `Utils.showNotification` (ADR 0064) shows a notification but reports neither its
 * click nor its id. Clicking a notification brings the app to the front, so a click is read as
 * the app coming back from the background (a window gaining focus while none had it, or macOS's
 * `reopen`) while a notification is pending. The cost: switching to the app by other means in
 * that window also counts as the click, which opens the Session that notified. Delivered
 * notifications cannot be removed. Both are recorded with the native-helper follow-up in
 * .agents/memory/electrobun-shell.md.
 */
const CLICK_WINDOW_MS = 10 * 60 * 1_000

interface PendingClick {
  readonly onClick: () => void
  readonly shownAt: number
}

interface WindowEvent {
  readonly data?: { readonly id?: number }
}

const tracking: { subscribed: boolean; pending: PendingClick | null } = {
  subscribed: false,
  pending: null,
}
const focusedWindows = new Set<number>()

function deliverPendingClick() {
  const pending = tracking.pending
  tracking.pending = null
  if (pending && Date.now() - pending.shownAt <= CLICK_WINDOW_MS) pending.onClick()
}

function windowId(event: WindowEvent) {
  return event.data?.id ?? null
}

function trackActivation(sdk: ElectrobunSdk) {
  if (tracking.subscribed) return
  tracking.subscribed = true
  sdk.events.on('focus', (event: WindowEvent) => {
    const id = windowId(event)
    if (id === null) return
    const fromBackground = focusedWindows.size === 0
    focusedWindows.add(id)
    if (fromBackground) deliverPendingClick()
  })
  sdk.events.on('blur', (event: WindowEvent) => {
    const id = windowId(event)
    if (id !== null) focusedWindows.delete(id)
  })
  sdk.events.on('reopen', deliverPendingClick)
}

function isSupported() {
  return !isAutomationMode() && loadedElectrobun() !== null
}

function show(request: SystemNotificationRequest, handlers: SystemNotificationHandlers = {}) {
  const sdk = loadedElectrobun()
  if (!sdk || isAutomationMode()) return null
  trackActivation(sdk)
  sdk.Utils.showNotification({ title: request.title, body: request.body, silent: request.silent })
  const onClick = handlers.onClick
  if (onClick) tracking.pending = { onClick, shownAt: Date.now() }
  handlers.onShow?.()
  return {
    close: () => {
      if (tracking.pending?.onClick === onClick) tracking.pending = null
    },
  }
}

export const electrobunSystemNotifications: SystemNotificationsShape = {
  isSupported,
  show,
  // Electrobun keeps no handle to a delivered notification.
  removeDelivered: () => undefined,
}
