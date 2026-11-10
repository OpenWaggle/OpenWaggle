import { electronBootShell } from '../adapters/electron/electron-boot-shell'
import type { BootShellShape } from '../ports/desktop-shell/boot-shell'

/** The desktop shell's BootShell (ADR 0064); the shell switch changes only this binding. */
export const bootShell: BootShellShape = electronBootShell
