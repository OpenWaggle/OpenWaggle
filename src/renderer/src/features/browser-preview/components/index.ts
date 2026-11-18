// Heavy preview surfaces stay out of the feature root index: the eager shell imports that index
// for stores and helpers, and re-exporting these panels there pulls them into the initial
// renderer graph. Load them through this entry, lazily.
export { BrowserPreviewFloatingPanel } from './BrowserPreviewFloatingPanel'
export { BrowserPreviewPanel } from './BrowserPreviewPanel'
