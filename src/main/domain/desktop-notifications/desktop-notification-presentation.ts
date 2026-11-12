import type {
  BundledNotificationSoundId,
  DesktopNotification,
  DesktopNotificationSettings,
} from '@shared/types/desktop-notification'
import { isBundledNotificationSound } from '@shared/types/desktop-notification'

/** Where the person is when a notification arrives, as the desktop app sees it. */
export interface DesktopNotificationAudience {
  /** An OpenWaggle window has focus. */
  readonly focused: boolean
  /** The Session the focused window shows, if any. */
  readonly viewingSessionId: string | null
  /** A window exists that could play an app sound. */
  readonly windowAvailable: boolean
}

/** How the desktop app presents one Desktop notification. */
export interface DesktopNotificationPresentation {
  /** Show an operating-system notification. */
  readonly show: boolean
  /**
   * The operating system's own sound (System default, or no window to play the app's): with the
   * notification when shown, otherwise the system beep.
   */
  readonly systemSound: boolean
  /** The app plays this bundled Notification sound. */
  readonly appSound: BundledNotificationSoundId | null
}

const NOTHING: DesktopNotificationPresentation = { show: false, systemSound: false, appSound: null }

/**
 * The focus rule (ADR 0062, CONTEXT.md): unfocused, show it with its sound, even for the Session on
 * screen; focused on that Session, nothing; focused elsewhere, the "While OpenWaggle is focused"
 * choice. The app plays its own sound and keeps the system one silent, unless no window can.
 */
export function desktopNotificationPresentation(
  notification: DesktopNotification,
  settings: DesktopNotificationSettings,
  audience: DesktopNotificationAudience,
) {
  if (!settings.enabled || !settings.categories[notification.category]) return NOTHING
  // The Host already showed it while no desktop app was connected.
  if (notification.presentedBy === 'host') return NOTHING
  const sound = settings.sounds[notification.category]
  const viewing =
    notification.target.kind === 'session' &&
    audience.viewingSessionId === notification.target.sessionId
  if (audience.focused && viewing) return NOTHING
  const show = !audience.focused || settings.whileFocused === 'show'
  if (audience.focused && settings.whileFocused === 'nothing') return NOTHING
  const appSound = isBundledNotificationSound(sound) && audience.windowAvailable ? sound : null
  const systemSound =
    sound === 'system' || (isBundledNotificationSound(sound) && !audience.windowAvailable)
  return { show, systemSound, appSound }
}

/** The Notification badge: outstanding notifications whose category is still switched on. */
export function desktopNotificationBadgeCount(
  notifications: Iterable<DesktopNotification>,
  settings: DesktopNotificationSettings,
) {
  if (!settings.enabled || !settings.showBadge) return 0
  let count = 0
  for (const notification of notifications) {
    if (settings.categories[notification.category]) count += 1
  }
  return count
}

/** What the Windows badge dot says to assistive technology: the count, as the Dock badge shows. */
function desktopNotificationBadgeLabel(count: number) {
  return count === 1 ? '1 notification' : `${String(count)} notifications`
}

/**
 * What to set on the Windows taskbar overlay when the badge count goes from `shown` to `count`,
 * or null to leave it. The dot's description carries the count, so any change sets it again.
 */
export function windowsBadgeOverlayUpdate(shown: number, count: number) {
  if (count === shown) return null
  return count > 0
    ? { show: true, description: desktopNotificationBadgeLabel(count) }
    : { show: false, description: '' }
}
