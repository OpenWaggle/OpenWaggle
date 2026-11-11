import { Context } from 'effect'

/** Whether an encoded image reached the clipboard; `undecodable` leaves the clipboard as it was. */
export type ClipboardImageWrite = 'written' | 'undecodable'

/**
 * The system clipboard (ADR 0064). Electrobun maps it to `Utils.clipboard*`, which takes PNG
 * only, so other encodings are converted first and an image write is asynchronous.
 */
export interface ClipboardShape {
  readonly readText: () => string
  readonly writeText: (text: string) => void
  /** Writes an encoded PNG, JPEG, GIF or WebP image as a bitmap. */
  readonly writeImage: (encodedImage: Uint8Array) => Promise<ClipboardImageWrite>
}

export class Clipboard extends Context.Tag('@openwaggle/Clipboard')<Clipboard, ClipboardShape>() {}
