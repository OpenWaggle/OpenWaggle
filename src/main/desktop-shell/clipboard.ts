import { electronClipboard } from '../adapters/electron/electron-clipboard'
import type { ClipboardShape } from '../ports/desktop-shell/clipboard'

/** The desktop shell's Clipboard (ADR 0064), bound to its Electron adapter. */
export const clipboard: ClipboardShape = electronClipboard
