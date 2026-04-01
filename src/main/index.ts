import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, Menu, shell } from 'electron'
import { initializeTokenStore } from './auth/token-manager'
import { startDevtoolsEventBus, stopDevtoolsEventBus } from './devtools/event-bus'
import { env } from './env'
import { persistAllActiveRuns } from './ipc/agent-handler'
import { cleanupTerminals, registerAllIpcHandlers } from './ipc/handlers'
import { createLogger, initFileLogger } from './logger'
import { mcpManager } from './mcp'
import { registerAllProviders } from './providers'
import { disposeAppRuntime, initializeAppRuntime, runAppEffect } from './runtime'
import {
  assertSecureWebPreferences,
  installCspHeaders,
  SECURE_WEB_PREFERENCES,
} from './security/electron-security'
import { configureAppStoragePaths } from './session-data'
import { getSettings, initializeSettingsStore } from './store/settings'
import { initializeTeamStore } from './store/teams'
import { registerRunSubAgent } from './sub-agents/facade'
import { runSubAgent } from './sub-agents/sub-agent-runner'
import { disposeAutoUpdater, initAutoUpdater } from './updater'

const WIDTH = 1200
const HEIGHT = 800
const MIN_WIDTH = 800
const MIN_HEIGHT = 600
const X = 16
const Y = 16
const FAILURE_EXIT_CODE = 1
configureAppStoragePaths(app, env.OPENWAGGLE_USER_DATA_DIR)

const appIconPath = is.dev
  ? join(__dirname, '../../build/icon.png')
  : join(process.resourcesPath, 'icon.png')
const logger = createLogger('main/index')
let ipcHandlersRegistered = false

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

async function bootstrapServicesAndWindow(): Promise<void> {
  await initializeAppRuntime()
  await Promise.all([initializeSettingsStore(), initializeTokenStore(), initializeTeamStore()])

  try {
    await Promise.all([registerAllProviders(), startDevtoolsEventBus()])
  } catch (error) {
    logger.error(
      'Provider or devtools bootstrap failed; continuing with degraded startup',
      describeError(error),
    )
  }

  registerIpcHandlersOnce()
  createWindow()
  initAutoUpdater()

  // MCP connects in background — not needed for initial render
  const settings = getSettings()
  mcpManager.initialize(settings.mcpServers).catch((error: unknown) => {
    logger.error(
      'MCP initialization failed; continuing without MCP connectivity',
      describeError(error),
    )
  })
}

function isTrustedRendererRequest(url: string): boolean {
  if (url.startsWith('file://')) return true
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
  const rendererOrigin = is.dev && env.ELECTRON_RENDERER_URL ? env.ELECTRON_RENDERER_URL : 'file://'
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

  if (is.dev && env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

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

    // Late-bind runSubAgent to break spawn-agent → sub-agent-runner cycle
    registerRunSubAgent(runSubAgent)

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

let mcpCleanupDone = false

app.on('window-all-closed', () => {
  cleanupTerminals()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', (e) => {
  stopDevtoolsEventBus()
  disposeAutoUpdater()
  if (!mcpCleanupDone) {
    e.preventDefault()
    runAppEffect(persistAllActiveRuns())
      .then(() => mcpManager.disconnectAll())
      .then(() => {
        mcpCleanupDone = true
        app.quit()
      })
      .catch(() => {
        mcpCleanupDone = true
        app.quit()
      })
  }
})
