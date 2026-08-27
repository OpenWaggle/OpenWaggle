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

export function configureDesktopUiAfterReady(app: App, appIconPath: string) {
  if (!isAutomationMode() && process.platform === 'darwin') app.dock?.setIcon(appIconPath)
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
