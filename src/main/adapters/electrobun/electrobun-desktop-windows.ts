import type { DesktopWindow, DesktopWindowsShape } from '../../ports/desktop-shell/desktop-windows'
import { createMainWindow, prepareMainWindow } from './electrobun-main-window'
import {
  allDesktopWindows,
  appWindowOf,
  desktopWindowOfSurface,
  focusedDesktopWindow,
  focusWindow,
  revealWindow,
  revealWindowInactive,
} from './electrobun-window-policy'
import { installElectrobunWindowShortcuts } from './electrobun-window-shortcuts'

/**
 * The app's windows on Electrobun (ADR 0064). A window's id is its Electrobun `BrowserWindow` id,
 * its page's surface id the Electrobun webview id. Windows open hidden under automation, and
 * showing or focusing one there throws `AutomationDesktopUiError` (`electrobun-window-policy.ts`).
 * Electrobun has no taskbar overlay icon, so `setOverlayIcon` does nothing; the Windows badge is
 * `SystemIntegrationShape`'s.
 */
function requireWindow(window: DesktopWindow) {
  const appWindow = appWindowOf(window)
  if (!appWindow) throw new Error('The window was closed.')
  return appWindow
}

export const electrobunDesktopWindows: DesktopWindowsShape = {
  // Nothing to patch over: every OS-visible Electrobun member asks `assertDesktopUiAllowed`
  // itself, and `openAppWindow` creates windows hidden under automation.
  installWindowPolicy: () => undefined,
  installWindowShortcuts: installElectrobunWindowShortcuts,
  openMainWindow: (request) => createMainWindow(request),
  prepareMainWindow,
  all: allDesktopWindows,
  focused: focusedDesktopWindow,
  fromSurface: desktopWindowOfSurface,
  reveal: (window) => revealWindow(requireWindow(window)),
  revealInactive: (window) => revealWindowInactive(requireWindow(window)),
  focus: (window) => focusWindow(requireWindow(window)),
  setOverlayIcon: () => undefined,
}
