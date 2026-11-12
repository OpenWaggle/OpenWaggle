import { electronMenus } from '../adapters/electron/electron-menus'
import type { DesktopMenusShape } from '../ports/desktop-shell/menus'

/** The desktop shell's DesktopMenus (ADR 0064); the shell switch changes only this binding. */
export const desktopMenus: DesktopMenusShape = electronMenus
