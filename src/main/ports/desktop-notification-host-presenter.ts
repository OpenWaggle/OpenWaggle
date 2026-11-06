import type { DesktopNotification } from '@shared/types/desktop-notification'
import { Context } from 'effect'

/**
 * How the Session Host shows a Desktop notification itself, when no desktop app is connected
 * (ADR 0062). Clicking it opens the desktop app on its Session.
 */
export interface DesktopNotificationHostPresenterShape {
  /** `system` plays the operating system's default sound, `none` stays silent. */
  readonly show: (notification: DesktopNotification, sound: 'system' | 'none') => void
  /** Closes what this process showed under `id`, if anything. */
  readonly withdraw: (notificationId: string) => void
}

export class DesktopNotificationHostPresenter extends Context.Tag(
  '@openwaggle/DesktopNotificationHostPresenter',
)<DesktopNotificationHostPresenter, DesktopNotificationHostPresenterShape>() {}
