import { clipboard, nativeImage } from 'electron'
import type { ClipboardShape } from '../../ports/desktop-shell/clipboard'

export const electronClipboard: ClipboardShape = {
  readText: () => clipboard.readText(),
  writeText: (text) => clipboard.writeText(text),
  writeImage: async (encodedImage) => {
    const image = nativeImage.createFromBuffer(Buffer.from(encodedImage))
    if (image.isEmpty()) return 'undecodable'
    clipboard.writeImage(image)
    return 'written'
  },
}
