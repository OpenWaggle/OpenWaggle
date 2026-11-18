import type { ClipboardImageBytes } from '@shared/types/clipboard'
import { Context } from 'effect'

/** Whether an encoded image reached the clipboard; `undecodable` leaves the clipboard as it was. */
export type ClipboardImageWrite = 'written' | 'undecodable'

/** The system clipboard (ADR 0064). */
export interface ClipboardShape {
  readonly readText: () => string
  /** The clipboard's image as PNG bytes, or `null` when it holds none. */
  readonly readImage: () => ClipboardImageBytes | null
  readonly writeText: (text: string) => void
  /** Writes an encoded PNG, JPEG, GIF or WebP image as a bitmap. */
  readonly writeImage: (encodedImage: Uint8Array) => ClipboardImageWrite
}

export class Clipboard extends Context.Tag('@openwaggle/Clipboard')<Clipboard, ClipboardShape>() {}
