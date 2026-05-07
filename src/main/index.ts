import { existsSync } from 'node:fs'
import { extname, join, posix, resolve, sep } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, Menu, protocol, shell } from 'electron'
import { reconcileInterruptedAgentRuns } from './application/agent-run-service'
import { env } from './env'
import { persistAllActiveRuns } from './ipc/agent-handler'
import { cleanupTerminals, registerAllIpcHandlers } from './ipc/handlers'
import { createLogger, initFileLogger } from './logger'
import { disposeAppRuntime, initializeAppRuntime, runAppEffect } from './runtime'
import {
  assertSecureWebPreferences,
  installCspHeaders,
  SECURE_WEB_PREFERENCES,
} from './security/electron-security'
import { configureAppStoragePaths } from './session-data'
import { initializeSettingsStore } from './store/settings'
import { disposeAutoUpdater, initAutoUpdater } from './updater'

const WIDTH = 1200
const HEIGHT = 800
const MIN_WIDTH = 800
const MIN_HEIGHT = 600
const X = 16
const Y = 16
const FAILURE_EXIT_CODE = 1
const RENDERER_PROTOCOL = 'openwaggle'
const RENDERER_PROTOCOL_HOST = 'app'
const RENDERER_PROTOCOL_ORIGIN = `${RENDERER_PROTOCOL}://${RENDERER_PROTOCOL_HOST}`
const INDEX_HTML = 'index.html'
const ELECTRON_FILE_NOT_FOUND_ERROR_CODE = -6

protocol.registerSchemesAsPrivileged([
  {
    scheme: RENDERER_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
])

const appIconPath = is.dev
  ? join(__dirname, '../../build/icon.png')
  : join(process.resourcesPath, 'icon.png')
const logger = createLogger('main/index')
let ipcHandlersRegistered = false
let rendererProtocolRegistered = false
let beforeQuitCleanupDone = false

function buildApplicationMenu(): void {
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        },
        {
          label: 'Edit',
          submenu: [
            { role: 'undo' },
            { role: 'redo' },
            { type: 'separator' },
            { role: 'cut' },
            { role: 'copy' },
            { role: 'paste' },
            { role: 'selectAll' },
          ],
        },
      ]),
    )
  } else {
    Menu.setApplicationMenu(null)
  }
}

function describeError(error: unknown): { message: string; name?: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    }
  }

  return { message: String(error) }
}

function registerIpcHandlersOnce(): void {
  if (ipcHandlersRegistered) {
    logger.warn('Skipping duplicate IPC handler registration')
    return
  }

  ipcHandlersRegistered = true

  registerAllIpcHandlers()
}

function rendererRootPath(): string {
  return resolve(__dirname, '../renderer')
}

function normalizedRendererRequestPath(requestUrl: string): string {
  const url = new URL(requestUrl)
  return posix.normalize(decodeURIComponent(url.pathname)).replace(/^\/+/, '')
}

function isRendererStaticAssetRequest(requestUrl: string): boolean {
  try {
    return extname(normalizedRendererRequestPath(requestUrl)).length > 0
  } catch {
    return false
  }
}

function isRendererIndexRequest(requestUrl: string): boolean {
  try {
    const normalizedPath = normalizedRendererRequestPath(requestUrl)
    return normalizedPath.length === 0 || normalizedPath === INDEX_HTML
  } catch {
    return false
  }
}

function resolveRendererFilePath(rendererRoot: string, requestUrl: string): string {
  const indexPath = join(rendererRoot, INDEX_HTML)
  const url = new URL(requestUrl)

  if (url.host !== RENDERER_PROTOCOL_HOST) {
    return indexPath
  }

  const normalizedPath = normalizedRendererRequestPath(requestUrl)
  if (normalizedPath.includes('..')) {
    return indexPath
  }

  const requestedPath = normalizedPath.length > 0 ? normalizedPath : INDEX_HTML
  const candidatePath = resolve(rendererRoot, requestedPath)
  const rendererRootPrefix = `${rendererRoot}${sep}`
  const isInsideRendererRoot =
    candidatePath === rendererRoot || candidatePath.startsWith(rendererRootPrefix)

  if (isInsideRendererRoot && existsSync(candidatePath)) {
    return candidatePath
  }

  return indexPath
}

function devRendererUrl(): string | null {
  return is.dev && env.ELECTRON_RENDERER_URL ? env.ELECTRON_RENDERER_URL : null
}

function registerRendererProtocolOnce(): void {
  if (rendererProtocolRegistered || devRendererUrl() !== null) {
    return
  }

  rendererProtocolRegistered = true
  const rendererRoot = rendererRootPath()
  const indexPath = join(rendererRoot, INDEX_HTML)

  protocol.registerFileProtocol(RENDERER_PROTOCOL, (request, callback) => {
    try {
      const candidatePath = resolveRendererFilePath(rendererRoot, request.url)
      const isAssetRequest = isRendererStaticAssetRequest(request.url)
      if (isAssetRequest && candidatePath === indexPath && !isRendererIndexRequest(request.url)) {
        callback({ error: ELECTRON_FILE_NOT_FOUND_ERROR_CODE })
        return
      }
      callback({ path: candidatePath })
    } catch {
      callback({ path: indexPath })
    }
  })
}

async function bootstrapServicesAndWindow(): Promise<void> {
  await initializeAppRuntime()
  await initializeSettingsStore()
  await runAppEffect(reconcileInterruptedAgentRuns())

  registerIpcHandlersOnce()
  registerRendererProtocolOnce()
  createWindow()
  initAutoUpdater()
}

function isTrustedRendererProtocolRequest(url: string): boolean {
  try {
    const parsedUrl = new URL(url)
    return (
      parsedUrl.protocol === `${RENDERER_PROTOCOL}:` && parsedUrl.host === RENDERER_PROTOCOL_HOST
    )
  } catch {
    return false
  }
}

function isTrustedRendererRequest(url: string): boolean {
  if (url.startsWith('file://')) return true
  if (isTrustedRendererProtocolRequest(url)) return true
  if (!env.ELECTRON_RENDERER_URL) return false

  try {
    return new URL(url).origin === new URL(env.ELECTRON_RENDERER_URL).origin
  } catch {
    return false
  }
}

function createWindow(): void {
  const webPreferences = {
    preload: join(__dirname, '../preload/index.js'),
    ...SECURE_WEB_PREFERENCES,
  }
  assertSecureWebPreferences(webPreferences)

  const mainWindow = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: X, y: Y },
    backgroundColor: '#141619',
    icon: appIconPath,
    webPreferences,
  })
  installCspHeaders(mainWindow.webContents.session)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('enter-full-screen', () => {
    mainWindow.webContents.send('window:fullscreen-changed', true)
  })
  mainWindow.on('leave-full-screen', () => {
    mainWindow.webContents.send('window:fullscreen-changed', false)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Prevent in-app navigation — all external URLs open in the user's default browser
  const rendererOrigin =
    is.dev && env.ELECTRON_RENDERER_URL ? env.ELECTRON_RENDERER_URL : RENDERER_PROTOCOL_ORIGIN
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(rendererOrigin)) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  const mediaPermissions = new Set(['media', 'microphone'])
  mainWindow.webContents.session.setPermissionCheckHandler(
    (_webContents, permission, requestingOrigin) => {
      if (!mediaPermissions.has(permission)) return false
      return isTrustedRendererRequest(requestingOrigin)
    },
  )
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      if (!mediaPermissions.has(permission)) {
        callback(false)
        return
      }
      callback(isTrustedRendererRequest(details.requestingUrl))
    },
  )

  const rendererDevUrl = devRendererUrl()
  if (rendererDevUrl !== null) {
    mainWindow.loadURL(rendererDevUrl)
  } else {
    mainWindow.loadURL(`${RENDERER_PROTOCOL_ORIGIN}/${INDEX_HTML}`)
  }
}

function focusExistingWindow(): void {
  const existingWindow = BrowserWindow.getAllWindows()[0]
  if (!existingWindow) {
    return
  }

  if (existingWindow.isMinimized()) {
    existingWindow.restore()
  }

  existingWindow.show()
  existingWindow.focus()
}

function registerAppLifecycle(): void {
  app
    .whenReady()
    .then(() => {
      electronApp.setAppUserModelId('com.openwaggle.app')
      if (process.platform === 'darwin') {
        app.dock?.setIcon(appIconPath)
      }

      app.on('browser-window-created', (_, window) => {
        optimizer.watchWindowShortcuts(window)
      })

      buildApplicationMenu()

      // Initialize file logger now that app paths are available
      void initFileLogger(app.getPath('logs'))

      void bootstrapServicesAndWindow().catch((error: unknown) => {
        logger.error('Bootstrap failed; quitting for safety', describeError(error))
        app.exit(FAILURE_EXIT_CODE)
      })

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
      })

      app.on('will-quit', () => {
        void disposeAppRuntime()
      })
    })
    .catch((error: unknown) => {
      logger.error('App startup failed before ready', describeError(error))
    })

  app.on('window-all-closed', () => {
    cleanupTerminals()
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('before-quit', (e) => {
    disposeAutoUpdater()
    if (!beforeQuitCleanupDone) {
      e.preventDefault()
      runAppEffect(persistAllActiveRuns())
        .then(() => {
          beforeQuitCleanupDone = true
          app.quit()
        })
        .catch(() => {
          beforeQuitCleanupDone = true
          app.quit()
        })
    }
  })
}

function startApp(): void {
  configureAppStoragePaths(app, env.OPENWAGGLE_USER_DATA_DIR)

  if (env.OPENWAGGLE_DISABLE_SINGLE_INSTANCE !== '1') {
    if (!app.requestSingleInstanceLock()) {
      logger.warn('Another OpenWaggle instance is already running; quitting this instance')
      app.quit()
      return
    }
    app.on('second-instance', focusExistingWindow)
  }

  registerAppLifecycle()
}

startApp()
