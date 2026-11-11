import { electrobunBootShell } from '../adapters/electrobun/electrobun-boot-shell'
import type { BootShellShape } from '../ports/desktop-shell/boot-shell'

/** The desktop shell's BootShell (ADR 0064), bound to its Electrobun adapter. */
export const bootShell: BootShellShape = electrobunBootShell
