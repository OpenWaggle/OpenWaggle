import { BROWSER_PREVIEW_ELEMENT_PICKER_CONTEXT } from './browser-preview-element-picker-script/context'
import { BROWSER_PREVIEW_ELEMENT_PICKER_EDITOR } from './browser-preview-element-picker-script/editor'
import { BROWSER_PREVIEW_ELEMENT_PICKER_EDITOR_CONTROLS } from './browser-preview-element-picker-script/editor-controls'
import { BROWSER_PREVIEW_ELEMENT_PICKER_FOUNDATION } from './browser-preview-element-picker-script/foundation'
import { BROWSER_PREVIEW_ELEMENT_PICKER_LIFECYCLE } from './browser-preview-element-picker-script/lifecycle'
import { BROWSER_PREVIEW_ELEMENT_PICKER_TOOLS } from './browser-preview-element-picker-script/tools'

export const BROWSER_PREVIEW_ELEMENT_PICKER_WORLD_ID = 1_704

/**
 * Runs in an Electron isolated world. The page can see the painted overlay but cannot reach its
 * closed shadow root or the controller stored on this world's global object.
 */
export const BROWSER_PREVIEW_ELEMENT_PICKER_SCRIPT = [
  BROWSER_PREVIEW_ELEMENT_PICKER_FOUNDATION,
  BROWSER_PREVIEW_ELEMENT_PICKER_CONTEXT,
  BROWSER_PREVIEW_ELEMENT_PICKER_EDITOR,
  BROWSER_PREVIEW_ELEMENT_PICKER_EDITOR_CONTROLS,
  BROWSER_PREVIEW_ELEMENT_PICKER_TOOLS,
  BROWSER_PREVIEW_ELEMENT_PICKER_LIFECYCLE,
].join('\n')

export const BROWSER_PREVIEW_ELEMENT_PICKER_CANCEL_SCRIPT = `
(() => {
  const state = globalThis.__openwaggleBrowserPreviewElementPicker;
  if (!state || typeof state.cancel !== 'function') return false;
  state.cancel();
  return true;
})()
`

export const BROWSER_PREVIEW_ELEMENT_PICKER_CAPTURED_SCRIPT = `
(() => {
  const state = globalThis.__openwaggleBrowserPreviewElementPicker;
  if (!state || typeof state.completeCapture !== 'function') return false;
  state.completeCapture();
  return true;
})()
`
