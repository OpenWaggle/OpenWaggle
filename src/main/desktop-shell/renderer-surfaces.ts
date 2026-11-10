import { electronRendererSurfaces } from '../adapters/electron/electron-renderer-surfaces'
import type { RendererSurfacesShape } from '../ports/desktop-shell/renderer-surfaces'

/** The desktop shell's RendererSurfaces (ADR 0064); the shell switch changes only this binding. */
export const rendererSurfaces: RendererSurfacesShape = electronRendererSurfaces
