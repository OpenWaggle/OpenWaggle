import { electronClipboard } from '../adapters/electron/electron-clipboard'
import type { ClipboardShape } from '../ports/desktop-shell/clipboard'

/** The desktop shell's Clipboard (ADR 0064); the shell switch changes only this binding. */
export const clipboard: ClipboardShape = electronClipboard
