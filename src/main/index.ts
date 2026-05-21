import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, Menu, shell } from 'electron'
import { reconcileInterruptedAgentRuns } from './application/agent-run-service'
import { env } from './env'
import { persistAllActiveRuns } from './ipc/agent-handler'
import { cleanupTerminals, registerAllIpcHandlers } from './ipc/handlers'
import { createLogger, initFileLogger } from './logger'
import {
  devRendererUrl,
  INDEX_HTML,
  RENDERER_PROTOCOL,
  RENDERER_PROTOCOL_HOST,
  RENDERER_PROTOCOL_ORIGIN,
  registerRendererProtocolOnce,
  registerRendererScheme,
} from './renderer-protocol'
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
registerRendererScheme()

const appIconPath = is.dev
  ? join(__dirname, '../../build/icon.png')
  : join(process.resourcesPath, 'icon.png')
const logger = createLogger('main/index')
let ipcHandlersRegistered = false
let beforeQuitCleanupDone = false

function buildApplicationMenu() {
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

function describeError(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    }
  }

  return { message: String(error) }
}

function registerIpcHandlersOnce() {
  if (ipcHandlersRegistered) {
    logger.warn('Skipping duplicate IPC handler registration')
    return
  }

  ipcHandlersRegistered = true

  registerAllIpcHandlers()
}

async function bootstrapServicesAndWindow() {
  await initializeAppRuntime()
  await initializeSettingsStore()
  await runAppEffect(reconcileInterruptedAgentRuns())

  registerIpcHandlersOnce()
  registerRendererProtocolOnce()
  createWindow()
  initAutoUpdater()
}

function isTrustedRendererProtocolRequest(url: string) {
  try {
    const parsedUrl = new URL(url)
    return (
      parsedUrl.protocol === `${RENDERER_PROTOCOL}:` && parsedUrl.host === RENDERER_PROTOCOL_HOST
    )
  } catch {
    return false
  }
}

function isTrustedRendererRequest(url: string) {
  if (url.startsWith('file://')) return true
  if (isTrustedRendererProtocolRequest(url)) return true
  if (!env.ELECTRON_RENDERER_URL) return false

  try {
    return new URL(url).origin === new URL(env.ELECTRON_RENDERER_URL).origin
  } catch {
    return false
  }
}

function createWindow() {
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

function focusExistingWindow() {
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

function registerAppLifecycle() {
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

function startApp() {
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
