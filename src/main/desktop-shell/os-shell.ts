import { electrobunOsShell } from '../adapters/electrobun/electrobun-os-shell'
import type { OsShellShape } from '../ports/desktop-shell/os-shell'

/** The desktop shell's OsShell (ADR 0064), bound to its Electrobun adapter. */
export const osShell: OsShellShape = electrobunOsShell
