import { electrobunBrowserPreviewViews } from '../adapters/electrobun/electrobun-browser-preview'
import type { BrowserPreviewViewsShape } from '../ports/desktop-shell/browser-preview-views'

/** The desktop shell's BrowserPreviewViews (ADR 0064), bound to its Electrobun adapter. */
export const browserPreviewViews: BrowserPreviewViewsShape = electrobunBrowserPreviewViews
