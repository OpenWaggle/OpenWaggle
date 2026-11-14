import { BrowserWindow, nativeImage } from 'electron'
import { isAutomationMode } from '../../desktop-automation-policy'
import type { DesktopWindowsShape } from '../../ports/desktop-shell/desktop-windows'
import { createMainWindow } from './electron-main-window'
import { installElectronWindowShortcuts } from './electron-window-shortcuts'
import {
  browserWindowFromWebContents,
  electronWebContentsOf,
  electronWindowOf,
  focusWindow,
  installAutomationDesktopUiBlockers,
  revealBrowserWindowInactive,
  revealWindow,
} from './electron-window-policy'

function requireWindow(window: Parameters<typeof electronWindowOf>[0]) {
  const electronWindow = electronWindowOf(window)
  if (!electronWindow) throw new Error('The window was closed.')
  return electronWindow
}

export const electronDesktopWindows: DesktopWindowsShape = {
  installWindowPolicy: installAutomationDesktopUiBlockers,
  installWindowShortcuts: installElectronWindowShortcuts,
  openMainWindow: (request) => createMainWindow(request),
  all: () => BrowserWindow.getAllWindows(),
  focused: () => BrowserWindow.getFocusedWindow(),
  fromSurface: (surface) => {
    const contents = electronWebContentsOf(surface)
    return contents ? browserWindowFromWebContents(contents) : null
  },
  reveal: (window) => revealWindow(requireWindow(window)),
  revealInactive: (window) => revealBrowserWindowInactive(requireWindow(window)),
  focus: (window) => focusWindow(requireWindow(window)),
  setOverlayIcon: (window, bitmap, description) => {
    if (isAutomationMode()) return
    const image = bitmap
      ? nativeImage.createFromBitmap(bitmap.pixels, { width: bitmap.width, height: bitmap.height })
      : null
    requireWindow(window).setOverlayIcon(image, description)
  },
}
