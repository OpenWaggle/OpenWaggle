import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { installDevToolsShortcut } from './application-menu'
import { createBrowserWindow, getAllBrowserWindows, isAutomationMode } from './desktop-ui'
import { focusWindow, revealWindow } from './desktop-window-policy'
import { env } from './env'
import { openExternalFromRenderer } from './external-navigation'
import {
  devRendererUrl,
  INDEX_HTML,
  isTrustedRendererRequest,
  RENDERER_PROTOCOL_ORIGIN,
  rendererUrlWithAutomationIdentity,
} from './renderer-protocol'
import {
  assertSecureWebPreferences,
  installCspHeaders,
  SECURE_WEB_PREFERENCES,
} from './security/electron-security'

const WIDTH = 1200
const HEIGHT = 800
const MIN_WIDTH = 800
const MIN_HEIGHT = 600
const TRAFFIC_LIGHT_X = 16
const TRAFFIC_LIGHT_Y = 16

export function createMainWindow(input: {
  readonly appIconPath: string
  readonly startupMark: (label: string) => void
}) {
  const webPreferences = {
    preload: join(__dirname, '../preload/index.js'),
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
    openExternalFromRenderer(details.url)
    return { action: 'deny' }
  })

  const rendererOrigin =
    is.dev && env.ELECTRON_RENDERER_URL ? env.ELECTRON_RENDERER_URL : RENDERER_PROTOCOL_ORIGIN
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(rendererOrigin)) return
    event.preventDefault()
    openExternalFromRenderer(url)
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
}

export function focusExistingWindow() {
  const existingWindow = getAllBrowserWindows()[0]
  if (existingWindow) focusWindow(existingWindow)
}
