import { electrobunSystemNotifications } from '../adapters/electrobun/electrobun-system-notifications'
import type { SystemNotificationsShape } from '../ports/desktop-shell/system-notifications'

/** The desktop shell's SystemNotifications (ADR 0064), bound to its Electrobun adapter. */
export const systemNotifications: SystemNotificationsShape = electrobunSystemNotifications
