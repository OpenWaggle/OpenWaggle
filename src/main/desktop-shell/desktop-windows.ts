import { electronDesktopWindows } from '../adapters/electron/electron-desktop-windows'
import type { DesktopWindowsShape } from '../ports/desktop-shell/desktop-windows'

/** The desktop shell's DesktopWindows (ADR 0064), bound to its Electron adapter. */
export const desktopWindows: DesktopWindowsShape = electronDesktopWindows
