import { electronSystemNotifications } from '../adapters/electron/electron-system-notifications'
import type { SystemNotificationsShape } from '../ports/desktop-shell/system-notifications'

/** The desktop shell's SystemNotifications (ADR 0064); the shell switch changes only this binding. */
export const systemNotifications: SystemNotificationsShape = electronSystemNotifications
