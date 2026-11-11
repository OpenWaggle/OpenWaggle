import type { ClipboardShape } from '../../ports/desktop-shell/clipboard'
import { loadSharp } from '../sharp-module'
import { electrobun } from './electrobun-sdk'

/**
 * Electrobun's clipboard (ADR 0064). `Utils.clipboardWriteImage` takes PNG bytes only, so every
 * image is decoded and written back as PNG through sharp first; bytes sharp cannot decode leave
 * the clipboard as it was. It reaches the SDK through `electrobun()` on use, so importing the
 * clipboard (as the IPC handlers do) never loads Electrobun's native library.
 */
async function pngOf(encodedImage: Uint8Array) {
  const sharp = await loadSharp()
  try {
    return new Uint8Array(await sharp(encodedImage).png().toBuffer())
  } catch {
    return null
  }
}

const utils = () => electrobun().Utils

export const electrobunClipboard: ClipboardShape = {
  readText: () => utils().clipboardReadText() ?? '',
  writeText: (text) => utils().clipboardWriteText(text),
  writeImage: async (encodedImage) => {
    const png = await pngOf(encodedImage)
    if (png === null) return 'undecodable'
    utils().clipboardWriteImage(png)
    return 'written'
  },
}
