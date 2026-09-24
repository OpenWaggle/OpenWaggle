import { optimizer } from '@electron-toolkit/utils'
import type { App, BrowserWindow } from 'electron'
import { configureApplicationMenu } from './application-menu'
import {
  AutomationDesktopUiError,
  installAutomationDesktopUiBlockers,
  isAutomationMode,
} from './desktop-ui'

export function prepareDesktopUi(app: App) {
  installAutomationDesktopUiBlockers()
  if (isAutomationMode() && process.platform === 'darwin') {
    app.setActivationPolicy('accessory')
  }
}

// Packaged apps take their Dock icon from the bundle's Info.plist; calling app.dock.setIcon
// at runtime makes macOS LaunchServices register a second Dock tile on every launch.
export function configureDesktopUiAfterReady(app: App) {
  if (!isAutomationMode()) {
    app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
  }
  configureApplicationMenu(app.name, !isAutomationMode())
}

export function revealWindow(window: BrowserWindow) {
  if (isAutomationMode()) throw new AutomationDesktopUiError('BrowserWindow.show')
  window.show()
}

export function focusWindow(window: BrowserWindow) {
  if (isAutomationMode()) throw new AutomationDesktopUiError('BrowserWindow.focus')
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}
