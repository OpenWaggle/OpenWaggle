import { electrobunMenus } from '../adapters/electrobun/electrobun-menus'
import type { DesktopMenusShape } from '../ports/desktop-shell/menus'

/** The desktop shell's DesktopMenus (ADR 0064), bound to its Electrobun adapter. */
export const desktopMenus: DesktopMenusShape = electrobunMenus
