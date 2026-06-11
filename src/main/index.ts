import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, shell } from 'electron'
import { configureApplicationMenu, installDevToolsShortcut } from './application-menu'
import { env } from './env'
import { registerExtensionFrameProtocolOnce } from './extension-frame-protocol'
import { registerExtensionRuntimeProtocolOnce } from './extension-runtime-protocol'
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
import {
  assertSecureWebPreferences,
  installCspHeaders,
  SECURE_WEB_PREFERENCES,
} from './security/electron-security'
import { configureAppStoragePaths } from './session-data'

const WIDTH = 1200
const HEIGHT = 800
const MIN_WIDTH = 800
const MIN_HEIGHT = 600
const X = 16
const Y = 16
const FAILURE_EXIT_CODE = 1
const STARTUP_TIMINGS_SWITCH = 'openwaggle-startup-timings'
const STARTUP_TIMING_PRECISION = 1

const importAgentHandlerModule = () => import('./ipc/agent-handler')
const importAgentRunServiceModule = () => import('./application/agent-run-service')
const importIpcHandlersModule = () => import('./ipc/handlers')
const importRuntimeModule = () => import('./runtime')
const importSettingsStoreModule = () => import('./store/settings')
const importUpdaterModule = () => import('./updater')

type AgentHandlerModule = Awaited<ReturnType<typeof importAgentHandlerModule>>
type IpcHandlersModule = Awaited<ReturnType<typeof importIpcHandlersModule>>
type RuntimeModule = Awaited<ReturnType<typeof importRuntimeModule>>

registerRendererScheme()

const appIconPath = is.dev
  ? join(__dirname, '../../build/icon.png')
  : join(process.resourcesPath, 'icon.png')
const logger = createLogger('main/index')
const startupStartedAt = performance.now()
let ipcHandlersRegistered = false
let beforeQuitCleanupDone = false
let cleanupTerminalsOnce: IpcHandlersModule['cleanupTerminals'] | null = null
let disposeAutoUpdaterOnce: (() => void) | null = null
let persistAllActiveRunsOnce: AgentHandlerModule['persistAllActiveRuns'] | null = null
let runtimeModulePromise: Promise<RuntimeModule> | null = null

function describeError(error: unknown) {
  return error instanceof Error
    ? { message: error.message, name: error.name, stack: error.stack }
    : { message: String(error) }
}

function startupMark(label: string) {
  if (!app.commandLine.hasSwitch(STARTUP_TIMINGS_SWITCH)) {
    return
  }

  logger.info('Startup timing', {
    label,
    elapsedMs: Number((performance.now() - startupStartedAt).toFixed(STARTUP_TIMING_PRECISION)),
  })
}

function getRuntimeModule() {
  runtimeModulePromise ??= importRuntimeModule()
  return runtimeModulePromise
}

async function registerIpcHandlersOnce() {
  if (ipcHandlersRegistered) {
    logger.warn('Skipping duplicate IPC handler registration')
    return
  }

  const [ipcHandlersModule, agentHandlerModule] = await Promise.all([
    importIpcHandlersModule(),
    importAgentHandlerModule(),
  ])

  ipcHandlersRegistered = true
  cleanupTerminalsOnce = ipcHandlersModule.cleanupTerminals
  persistAllActiveRunsOnce = agentHandlerModule.persistAllActiveRuns

  ipcHandlersModule.registerAllIpcHandlers()
}

async function initializeAutoUpdaterAfterWindow() {
  try {
    const { disposeAutoUpdater, initAutoUpdater } = await importUpdaterModule()
    disposeAutoUpdaterOnce = disposeAutoUpdater
    initAutoUpdater()
  } catch (error) {
    logger.warn('Failed to initialize auto-updater', describeError(error))
  }
}

async function persistActiveRunsBeforeQuit() {
  const [runtimeModule, agentHandlerModule] = await Promise.all([
    getRuntimeModule(),
    persistAllActiveRunsOnce ? Promise.resolve(null) : importAgentHandlerModule(),
  ])
  const persistAllActiveRuns =
    persistAllActiveRunsOnce ?? agentHandlerModule?.persistAllActiveRuns ?? null

  if (!persistAllActiveRuns) {
    return
  }

  await runtimeModule.runAppEffect(persistAllActiveRuns())
}

async function bootstrapServicesAndWindow() {
  startupMark('bootstrap-start')

  const [runtimeModule, settingsStoreModule, agentRunServiceModule] = await Promise.all([
    getRuntimeModule(),
    importSettingsStoreModule(),
    importAgentRunServiceModule(),
  ])
  startupMark('startup-modules-imported')

  await runtimeModule.initializeAppRuntime()
  startupMark('app-runtime-initialized')

  await settingsStoreModule.initializeSettingsStore()
  startupMark('settings-store-initialized')

  await runtimeModule.runAppEffect(agentRunServiceModule.reconcileInterruptedAgentRuns())
  startupMark('interrupted-runs-reconciled')

  const trustedMainActivationModule = await import(
    './application/extension-trusted-main-activation-service'
  )
  await runtimeModule.runAppEffect(
    trustedMainActivationModule.activateTrustedMainExtensionsForActiveProject(),
  )

  await registerIpcHandlersOnce()
  startupMark('ipc-handlers-registered')

  registerRendererProtocolOnce()
  registerExtensionFrameProtocolOnce()
  registerExtensionRuntimeProtocolOnce()
  startupMark('protocol-handlers-registered')

  createWindow()
  startupMark('main-window-created')

  void initializeAutoUpdaterAfterWindow()
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
  installDevToolsShortcut(mainWindow)

  mainWindow.on('ready-to-show', () => {
    startupMark('window-ready-to-show')
    mainWindow.show()
    startupMark('window-shown')
  })

  mainWindow.webContents.once('dom-ready', () => startupMark('renderer-dom-ready'))
  mainWindow.webContents.once('did-finish-load', () => startupMark('renderer-did-finish-load'))

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
  startupMark('renderer-load-start')
  if (rendererDevUrl !== null) {
    void mainWindow.loadURL(rendererDevUrl)
  } else {
    void mainWindow.loadURL(`${RENDERER_PROTOCOL_ORIGIN}/${INDEX_HTML}`)
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

      configureApplicationMenu(app.name)

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
        void runtimeModulePromise?.then(({ disposeAppRuntime }) => disposeAppRuntime())
      })
    })
    .catch((error: unknown) => {
      logger.error('App startup failed before ready', describeError(error))
    })

  app.on('window-all-closed', () => {
    cleanupTerminalsOnce?.()
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('before-quit', (e) => {
    disposeAutoUpdaterOnce?.()
    if (!beforeQuitCleanupDone) {
      e.preventDefault()
      persistActiveRunsBeforeQuit()
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
