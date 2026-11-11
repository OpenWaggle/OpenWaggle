import { electrobunDialogs } from '../adapters/electrobun/electrobun-dialogs'
import type { DesktopDialogsShape } from '../ports/desktop-shell/dialogs'

/** The desktop shell's DesktopDialogs (ADR 0064), bound to its Electrobun adapter. */
export const desktopDialogs: DesktopDialogsShape = electrobunDialogs
