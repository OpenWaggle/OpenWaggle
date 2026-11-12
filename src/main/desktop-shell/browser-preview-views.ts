import { electronBrowserPreviewViews } from '../adapters/electron/electron-browser-preview-views'
import type { BrowserPreviewViewsShape } from '../ports/desktop-shell/browser-preview-views'

/** The desktop shell's BrowserPreviewViews (ADR 0064); the shell switch changes only this binding. */
export const browserPreviewViews: BrowserPreviewViewsShape = electronBrowserPreviewViews
