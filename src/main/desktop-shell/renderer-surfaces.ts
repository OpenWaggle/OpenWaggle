import { electronRendererSurfaces } from '../adapters/electron/electron-renderer-surfaces'
import type { RendererSurfacesShape } from '../ports/desktop-shell/renderer-surfaces'

/** The desktop shell's RendererSurfaces (ADR 0064), bound to its Electron adapter. */
export const rendererSurfaces: RendererSurfacesShape = electronRendererSurfaces
