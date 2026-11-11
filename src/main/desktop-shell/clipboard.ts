import { electrobunClipboard } from '../adapters/electrobun/electrobun-clipboard'
import type { ClipboardShape } from '../ports/desktop-shell/clipboard'

/** The desktop shell's Clipboard (ADR 0064), bound to its Electrobun adapter. */
export const clipboard: ClipboardShape = electrobunClipboard
