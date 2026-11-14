import { webContents } from 'electron'
import type { RendererSurfacesShape } from '../../ports/desktop-shell/renderer-surfaces'

/** Every Electron `WebContents` is a renderer surface; its id is the `WebContents` id. */
export const electronRendererSurfaces: RendererSurfacesShape = {
  fromId: (id) => webContents.fromId(id) ?? null,
}
