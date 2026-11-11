import { electrobunDesktopWindows } from '../adapters/electrobun/electrobun-desktop-windows'
import type { DesktopWindowsShape } from '../ports/desktop-shell/desktop-windows'

/** The desktop shell's DesktopWindows (ADR 0064), bound to its Electrobun adapter. */
export const desktopWindows: DesktopWindowsShape = electrobunDesktopWindows
