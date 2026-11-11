import { electrobunRendererSurfaces } from '../adapters/electrobun/electrobun-renderer-surfaces'
import type { RendererSurfacesShape } from '../ports/desktop-shell/renderer-surfaces'

/** The desktop shell's RendererSurfaces (ADR 0064), bound to its Electrobun adapter. */
export const rendererSurfaces: RendererSurfacesShape = electrobunRendererSurfaces
