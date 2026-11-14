import { electronSystemNotifications } from '../adapters/electron/electron-system-notifications'
import type { SystemNotificationsShape } from '../ports/desktop-shell/system-notifications'

/** The desktop shell's SystemNotifications (ADR 0064), bound to its Electron adapter. */
export const systemNotifications: SystemNotificationsShape = electronSystemNotifications
