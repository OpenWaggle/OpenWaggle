import { electronDialogs } from '../adapters/electron/electron-dialogs'
import type { DesktopDialogsShape } from '../ports/desktop-shell/dialogs'

/** The desktop shell's DesktopDialogs (ADR 0064); the shell switch changes only this binding. */
export const desktopDialogs: DesktopDialogsShape = electronDialogs
