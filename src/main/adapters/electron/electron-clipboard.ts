import { clipboard, nativeImage } from 'electron'
import type { ClipboardShape } from '../../ports/desktop-shell/clipboard'

export const electronClipboard: ClipboardShape = {
  readText: () => clipboard.readText(),
  readImage: () => {
    const image = clipboard.readImage()
    return image.isEmpty() ? null : { bytes: image.toPNG(), mimeType: 'image/png' }
  },
  writeText: (text) => clipboard.writeText(text),
  writeImage: (encodedImage) => {
    const image = nativeImage.createFromBuffer(Buffer.from(encodedImage))
    if (image.isEmpty()) return 'undecodable'
    clipboard.writeImage(image)
    return 'written'
  },
}
