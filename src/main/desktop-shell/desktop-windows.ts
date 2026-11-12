import { electronDesktopWindows } from '../adapters/electron/electron-desktop-windows'
import type { DesktopWindowsShape } from '../ports/desktop-shell/desktop-windows'

/** The desktop shell's DesktopWindows (ADR 0064); the shell switch changes only this binding. */
export const desktopWindows: DesktopWindowsShape = electronDesktopWindows
