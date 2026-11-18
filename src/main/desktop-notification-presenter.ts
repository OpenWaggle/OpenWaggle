import { desktopNotificationListSchema } from '@shared/schemas/desktop-notification'
import type {
  DesktopNotification,
  DesktopNotificationPermissionStatus,
} from '@shared/types/desktop-notification'
import { DEFAULT_DESKTOP_NOTIFICATION_SETTINGS } from '@shared/types/desktop-notification'
import type { SessionHostEventPayload } from '@shared/types/session-host-event'
import { sessionLink } from '@shared/utils/session-link'
import * as Schema from 'effect/Schema'
import { nativeNotificationBody } from './adapters/electron-desktop-notification-host-presenter'
import { invokeConfiguredHostUi } from './application/gui-session-command-router'
import { BADGE_OVERLAY_SIZE, badgeOverlayPixels } from './desktop-notification-badge-overlay'
import {
  getAllBrowserWindows,
  getFocusedBrowserWindow,
  nativeNotificationsSupported,
  playSystemAlertSound,
  removeDeliveredNativeNotification,
  setApplicationBadgeCount,
  setWindowOverlayIcon,
  showNativeNotification,
} from './desktop-ui'
import {
  desktopNotificationBadgeCount,
  desktopNotificationPresentation,
  windowsBadgeOverlayUpdate,
} from './domain/desktop-notifications/desktop-notification-presentation'
import { describeError } from './error-description'
import { createLogger } from './logger'
import type { DesktopWindow } from './ports/desktop-shell/desktop-windows'
import type { SystemNotificationHandle } from './ports/desktop-shell/system-notifications'
import { requestOpenSessionLink } from './session-link-requests'
import type * as SettingsStore from './store/settings'
import { broadcastToWindows } from './utils/broadcast'

const logger = createLogger('desktop-notifications')

interface DesktopNotificationPresenterInput {
  /** Focus the main window, or create one when there is none (as a Session link does). */
  readonly revealWindow: () => void
}

interface PresenterState {
  input: DesktopNotificationPresenterInput | null
  /** The GUI's Host-hydrated settings store, loaded on demand like the rest of the backend. */
  settingsStore: typeof SettingsStore | null
  readonly outstanding: Map<string, DesktopNotification>
  readonly shown: Map<string, SystemNotificationHandle>
  viewingSessionId: string | null
  permission: DesktopNotificationPermissionStatus
  /** The count the Windows overlay shows, 0 while it is hidden. */
  overlayCount: number
}

const state: PresenterState = {
  input: null,
  settingsStore: null,
  outstanding: new Map(),
  shown: new Map(),
  viewingSessionId: null,
  permission: 'not-asked',
  overlayCount: 0,
}

function settings() {
  try {
    return (
      state.settingsStore?.getSettings().desktopNotifications ??
      DEFAULT_DESKTOP_NOTIFICATION_SETTINGS
    )
  } catch {
    // Not hydrated from the Host yet.
    return DEFAULT_DESKTOP_NOTIFICATION_SETTINGS
  }
}

function initialPermission() {
  if (!nativeNotificationsSupported()) return 'unsupported' as const
  // Only macOS asks the person; elsewhere the system settings decide quietly.
  if (process.platform !== 'darwin') return 'allowed' as const
  return settings().permissionRequested ? ('allowed' as const) : ('not-asked' as const)
}

/**
 * Install the desktop app's side of Desktop notifications (ADR 0062): it shows what the Session
 * Host decided, applies the focus rule, plays sounds in the focused window and keeps the badge.
 */
export function installDesktopNotificationPresenter(input: DesktopNotificationPresenterInput) {
  state.input = input
  state.permission = initialPermission()
  void import('./store/settings').then((module) => {
    state.settingsStore = module
    if (state.permission === 'not-asked') state.permission = initialPermission()
  })
}

/** The Session the renderer shows; `null` when none. */
export function setDesktopNotificationViewingSession(sessionId: string | null) {
  state.viewingSessionId = sessionId
}

export function desktopNotificationPermissionStatus() {
  return state.permission
}

function updatePermission(status: DesktopNotificationPermissionStatus) {
  if (state.permission === status) return
  state.permission = status
  broadcastToWindows('desktop-notifications:permission-changed', status)
}

/** Relay a Host event about Desktop notifications; other events are ignored. */
export function presentDesktopNotificationEvent(payload: SessionHostEventPayload) {
  if (payload.kind === 'desktop-notification-shown') {
    const { notification } = payload
    const standing = state.outstanding.get(notification.id)
    if (standing && standing.revision >= notification.revision) return
    state.outstanding.delete(notification.id)
    state.outstanding.set(notification.id, notification)
    present(notification)
    refreshDesktopNotificationBadge()
    return
  }
  if (payload.kind === 'desktop-notification-withdrawn') {
    const standing = state.outstanding.get(payload.notificationId)
    if (!standing || standing.revision > payload.revision) return
    state.outstanding.delete(payload.notificationId)
    closeShown(payload.notificationId)
    refreshDesktopNotificationBadge()
  }
}

/** After (re)connecting to the Host: take its outstanding list, for the badge only. */
export async function reconcileDesktopNotifications() {
  try {
    const remote = await invokeConfiguredHostUi('desktop-notifications:list', [])
    if (!remote.handled) return
    const notifications = Schema.decodeUnknownSync(desktopNotificationListSchema)(remote.result)
    const current = new Set(notifications.map((notification) => notification.id))
    for (const id of state.outstanding.keys()) {
      if (!current.has(id)) closeShown(id)
    }
    state.outstanding.clear()
    for (const notification of notifications) state.outstanding.set(notification.id, notification)
    refreshDesktopNotificationBadge()
  } catch (error) {
    logger.warn('Could not read outstanding Desktop notifications', describeError(error))
  }
}

function present(notification: DesktopNotification) {
  const focusedWindow = getFocusedBrowserWindow()
  const window = focusedWindow ?? getAllBrowserWindows()[0] ?? null
  const presentation = desktopNotificationPresentation(notification, settings(), {
    focused: focusedWindow !== null,
    viewingSessionId: state.viewingSessionId,
    windowAvailable: window !== null,
  })
  if (presentation.appSound && window) {
    window.webContents.send('desktop-notifications:play-sound', { sound: presentation.appSound })
  }
  if (presentation.show) {
    showNotification(notification, !presentation.systemSound)
    return
  }
  if (presentation.systemSound) playSystemAlertSound()
}

function showNotification(notification: DesktopNotification, silent: boolean) {
  closeShown(notification.id)
  const native = showNativeNotification(
    {
      id: notification.id,
      groupId: notification.id,
      title: notification.title,
      body: nativeNotificationBody(notification),
      silent,
      // Windows drops the click once a notification moves to the Action Center.
      requireInteraction: process.platform === 'win32',
    },
    {
      onClick: () => openNotification(notification),
      onShow: () => updatePermission('allowed'),
      onFailed: (error) => {
        logger.warn('The system refused a notification', { error })
        if (process.platform === 'darwin') updatePermission('blocked')
      },
    },
  )
  if (native) state.shown.set(notification.id, native)
}

function closeShown(id: string) {
  state.shown.get(id)?.close()
  state.shown.delete(id)
  removeDeliveredNativeNotification(id)
}

/** A click opens the app on its Session, or on the Scheduled task it is about. */
function openNotification(notification: DesktopNotification) {
  state.shown.delete(notification.id)
  const { target } = notification
  if (target.kind === 'session') {
    const link = sessionLink(target.sessionId)
    if (link && requestOpenSessionLink(link)) state.input?.revealWindow()
    return
  }
  state.input?.revealWindow()
  broadcastToWindows('desktop-notifications:open-scheduled-task', { taskId: target.taskId })
}

/** Apply the Notification badge after a change to the list or the settings. */
export function refreshDesktopNotificationBadge() {
  const count = desktopNotificationBadgeCount(state.outstanding.values(), settings())
  if (process.platform === 'win32') {
    const window = getAllBrowserWindows()[0]
    if (window) applyWindowsOverlay(window, count)
    return
  }
  setApplicationBadgeCount(count)
}

function applyWindowsOverlay(window: DesktopWindow, count: number) {
  const update = windowsBadgeOverlayUpdate(state.overlayCount, count)
  if (!update) return
  state.overlayCount = count
  setWindowOverlayIcon(
    window,
    update.show
      ? { pixels: badgeOverlayPixels(), width: BADGE_OVERLAY_SIZE, height: BADGE_OVERLAY_SIZE }
      : null,
    update.description,
  )
}

/**
 * Ask the operating system, once: macOS asks the person the first time the app shows a
 * notification, so the first one tells them where the settings are.
 */
export function requestDesktopNotificationPermission() {
  if (state.permission === 'unsupported') return state.permission
  showNativeNotification(
    {
      id: 'openwaggle:notifications-on',
      groupId: 'openwaggle:notifications-on',
      title: 'Notifications are on',
      body: 'OpenWaggle will tell you about your Sessions and Scheduled tasks. Choose what notifies in Settings → Notifications.',
      silent: true,
    },
    {
      onShow: () => updatePermission('allowed'),
      onFailed: () => updatePermission(process.platform === 'darwin' ? 'blocked' : 'allowed'),
    },
  )
  return state.permission
}

/** A sample notification with the Needs you sound, from Settings → Notifications. */
export function sendTestDesktopNotification() {
  const preferences = settings()
  const window = getFocusedBrowserWindow() ?? getAllBrowserWindows()[0] ?? null
  const sample: DesktopNotification = {
    id: 'openwaggle:test',
    revision: 0,
    target: { kind: 'session', sessionId: '' },
    category: 'needs-you',
    reason: 'awaiting-approval',
    title: 'Test notification · OpenWaggle',
    body: 'This is how OpenWaggle tells you a Session needs you.',
    createdAt: Date.now(),
    presentedBy: 'desktop',
  }
  const sound = preferences.sounds['needs-you']
  if (window && sound !== 'system' && sound !== 'none') {
    window.webContents.send('desktop-notifications:play-sound', { sound })
  }
  closeShown(sample.id)
  const native = showNativeNotification(
    {
      id: sample.id,
      groupId: sample.id,
      title: sample.title,
      body: sample.body,
      silent: sound !== 'system',
    },
    {
      onShow: () => updatePermission('allowed'),
      onFailed: () => {
        if (process.platform === 'darwin') updatePermission('blocked')
      },
    },
  )
  if (native) state.shown.set(sample.id, native)
  return state.permission
}
