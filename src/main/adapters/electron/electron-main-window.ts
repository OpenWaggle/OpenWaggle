import { homedir } from 'node:os'
import { join } from 'node:path'
import { homeDirectoryRendererArguments } from '@shared/home-directory-argument'
import { app, type BrowserWindow, type Input } from 'electron'
import { isAutomationMode } from '../../desktop-automation-policy'
import type { MainWindowRequest } from '../../ports/desktop-shell/desktop-windows'
import { errorReportingRendererArguments } from '../../error-reporting'
import { isTrustedRendererDocument } from '../../renderer-document-trust'
import {
  devRendererUrl,
  INDEX_HTML,
  isTrustedRendererRequest,
  RENDERER_PROTOCOL_ORIGIN,
  rendererUrlWithAutomationIdentity,
} from '../../renderer-protocol'
import {
  assertSecureWebPreferences,
  installCspHeaders,
  SECURE_WEB_PREFERENCES,
} from '../../security/web-security-policy'
import { trustedOriginBaseRendererArguments } from '../../trusted-origin-base-arguments'
import { electronTrustedOrigins } from './electron-trusted-origins'
import { createBrowserWindow, revealWindow } from './electron-window-policy'

const WIDTH = 1200
const HEIGHT = 800
const MIN_WIDTH = 800
const MIN_HEIGHT = 600
const TRAFFIC_LIGHT_X = 16
const TRAFFIC_LIGHT_Y = 16

const DEVTOOLS_SHORTCUT_CODE = 'KeyI'

function isDevToolsShortcut(input: Input) {
  return (
    input.type === 'keyDown' &&
    input.code === DEVTOOLS_SHORTCUT_CODE &&
    ((input.meta && input.alt) || (input.control && input.shift))
  )
}

/** Unpackaged builds toggle DevTools with Cmd+Alt+I or Ctrl+Shift+I. */
function installDevToolsShortcut(window: BrowserWindow) {
  if (app.isPackaged) return
  window.webContents.on('before-input-event', (event, input) => {
    if (!isDevToolsShortcut(input)) return
    event.preventDefault()
    if (window.webContents.isDevToolsOpened()) {
      window.webContents.closeDevTools()
      return
    }
    window.webContents.openDevTools({ mode: 'undocked' })
  })
}

export function createMainWindow(input: MainWindowRequest) {
  const webPreferences = {
    preload: join(import.meta.dirname, '../preload/index.js'),
    // Tells the preload to expose the error-report bridge; empty unless this process reports errors.
    // The home directory lets display paths shorten it to `~` (`window.api.getHomeDirectory()`).
    // The trusted origin bases are where the page builds extension module URLs.
    additionalArguments: [
      ...errorReportingRendererArguments(),
      ...homeDirectoryRendererArguments(homedir()),
      ...trustedOriginBaseRendererArguments(electronTrustedOrigins),
    ],
    ...SECURE_WEB_PREFERENCES,
  }
  assertSecureWebPreferences(webPreferences)

  const mainWindow = createBrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: TRAFFIC_LIGHT_X, y: TRAFFIC_LIGHT_Y },
    backgroundColor: '#141719',
    icon: input.appIconPath,
    webPreferences,
  })
  installCspHeaders(mainWindow.webContents.session)
  if (!isAutomationMode()) installDevToolsShortcut(mainWindow)

  mainWindow.on('ready-to-show', () => {
    input.startupMark('window-ready-to-show')
    if (isAutomationMode()) return
    revealWindow(mainWindow)
    input.startupMark('window-shown')
  })
  mainWindow.webContents.once('dom-ready', () => input.startupMark('renderer-dom-ready'))
  mainWindow.webContents.once('did-finish-load', () =>
    input.startupMark('renderer-did-finish-load'),
  )
  mainWindow.on('enter-full-screen', () => {
    mainWindow.webContents.send('window:fullscreen-changed', true)
  })
  mainWindow.on('leave-full-screen', () => {
    mainWindow.webContents.send('window:fullscreen-changed', false)
  })
  mainWindow.webContents.setWindowOpenHandler((details) => {
    input.openLink(details.url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isTrustedRendererDocument(url)) return
    event.preventDefault()
    input.openLink(url)
  })

  const mediaPermissions = new Set(['media', 'microphone'])
  mainWindow.webContents.session.setPermissionCheckHandler(
    (_webContents, permission, requestingOrigin) => {
      if (isAutomationMode()) return false
      return mediaPermissions.has(permission) && isTrustedRendererRequest(requestingOrigin)
    },
  )
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      if (isAutomationMode()) {
        callback(false)
        return
      }
      callback(mediaPermissions.has(permission) && isTrustedRendererRequest(details.requestingUrl))
    },
  )

  const rendererDevUrl = devRendererUrl()
  input.startupMark('renderer-load-start')
  if (rendererDevUrl !== null) {
    void mainWindow.loadURL(rendererUrlWithAutomationIdentity(rendererDevUrl))
  } else {
    void mainWindow.loadURL(
      rendererUrlWithAutomationIdentity(`${RENDERER_PROTOCOL_ORIGIN}/${INDEX_HTML}`),
    )
  }
  return mainWindow
}
