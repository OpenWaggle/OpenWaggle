import { Utils } from 'electrobun/main'
import type { ClipboardShape } from '../../ports/desktop-shell/clipboard'
import { loadSharp } from '../sharp-module'

/**
 * Electrobun's clipboard (ADR 0064). `Utils.clipboardWriteImage` takes PNG bytes only, so every
 * image is decoded and written back as PNG through sharp first; bytes sharp cannot decode leave
 * the clipboard as it was.
 */
async function pngOf(encodedImage: Uint8Array) {
  const sharp = await loadSharp()
  try {
    return new Uint8Array(await sharp(encodedImage).png().toBuffer())
  } catch {
    return null
  }
}

export const electrobunClipboard: ClipboardShape = {
  readText: () => Utils.clipboardReadText() ?? '',
  writeText: (text) => Utils.clipboardWriteText(text),
  writeImage: async (encodedImage) => {
    const png = await pngOf(encodedImage)
    if (png === null) return 'undecodable'
    Utils.clipboardWriteImage(png)
    return 'written'
  },
}
