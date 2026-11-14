import { electronOsShell } from '../adapters/electron/electron-os-shell'
import type { OsShellShape } from '../ports/desktop-shell/os-shell'

/** The desktop shell's OsShell (ADR 0064), bound to its Electron adapter. */
export const osShell: OsShellShape = electronOsShell
