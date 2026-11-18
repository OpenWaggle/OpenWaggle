import { electronMenus } from '../adapters/electron/electron-menus'
import type { DesktopMenusShape } from '../ports/desktop-shell/menus'

/** The desktop shell's DesktopMenus (ADR 0064), bound to its Electron adapter. */
export const desktopMenus: DesktopMenusShape = electronMenus
