import { join } from 'node:path'
import { electronApp, is } from '@electron-toolkit/utils'
import { app } from 'electron'
import { completeAppRuntimeShutdown } from './application/app-runtime-shutdown'
import { readInlineVisualizationSource } from './application/inline-visualization-source-service'
import { installDevToolsShortcut } from './application-menu'
import { createBrowserWindow, getAllBrowserWindows, isAutomationMode } from './desktop-ui'
import {
  configureDesktopUiAfterReady,
  focusWindow,
  prepareDesktopUi,
  revealWindow,
} from './desktop-window-policy'
import { env } from './env'
import { describeError } from './error-description'
import { registerExtensionFrameProtocolOnce } from './extension-frame-protocol'
import { registerExtensionRuntimeProtocolOnce } from './extension-runtime-protocol'
import { openExternalFromRenderer } from './external-navigation'
import { installInlineVisualizationNavigationGuard } from './inline-visualization-navigation'
import { registerInlineVisualizationProtocolOnce } from './inline-visualization-protocol'
import { createLogger, initFileLogger } from './logger'
import { startMcpCliIfRequested } from './mcp-cli-entry'
import {
  configureInlineVisualizationProcessIsolation,
  devRendererUrl,
  INDEX_HTML,
  isTrustedRendererRequest,
  RENDERER_PROTOCOL_ORIGIN,
  registerRendererProtocolOnce,
  registerRendererScheme,
  rendererUrlWithAutomationIdentity,
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

configureInlineVisualizationProcessIsolation()
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
  const resolved = persistAllActiveRunsOnce ?? agentHandlerModule?.persistAllActiveRuns ?? null
  if (!resolved) return

  await runtimeModule.runAppEffect(resolved())
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

  if (isAutomationMode() && env.OPENWAGGLE_AUTOMATION_PROJECT_PATH) {
    settingsStoreModule.updateSettings({
      projectPath: env.OPENWAGGLE_AUTOMATION_PROJECT_PATH,
      recentProjects: [env.OPENWAGGLE_AUTOMATION_PROJECT_PATH],
    })
  }

  await runtimeModule.runAppEffect(agentRunServiceModule.reconcileInterruptedAgentRuns())
  startupMark('interrupted-runs-reconciled')

  const trustedMainActivationModule = await import(
    './application/extension-trusted-main-activation-service'
  )
  await runtimeModule.runAppEffect(
    trustedMainActivationModule.activateTrustedMainExtensionsForActiveProjectSafely(),
  )

  await registerIpcHandlersOnce()
  startupMark('ipc-handlers-registered')

  registerRendererProtocolOnce()
  registerExtensionFrameProtocolOnce()
  registerExtensionRuntimeProtocolOnce()
  registerInlineVisualizationProtocolOnce({
    readSource: (input) => runtimeModule.runAppEffect(readInlineVisualizationSource(input)),
  })
  startupMark('protocol-handlers-registered')

  createWindow()
  startupMark('main-window-created')

  if (!isAutomationMode()) void initializeAutoUpdaterAfterWindow()
}

function createWindow() {
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
    trafficLightPosition: { x: X, y: Y },
    backgroundColor: '#141719',
    icon: appIconPath,
    webPreferences,
  })
  installCspHeaders(mainWindow.webContents.session)
  if (!isAutomationMode()) installDevToolsShortcut(mainWindow)

  mainWindow.on('ready-to-show', () => {
    startupMark('window-ready-to-show')
    if (isAutomationMode()) return
    revealWindow(mainWindow)
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
    openExternalFromRenderer(details.url)
    return { action: 'deny' }
  })

  // Prevent in-app navigation — all external URLs open in the user's default browser
  const rendererOrigin =
    is.dev && env.ELECTRON_RENDERER_URL ? env.ELECTRON_RENDERER_URL : RENDERER_PROTOCOL_ORIGIN
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(rendererOrigin)) {
      event.preventDefault()
      openExternalFromRenderer(url)
    }
  })
  installInlineVisualizationNavigationGuard(mainWindow.webContents)

  const mediaPermissions = new Set(['media', 'microphone'])
  mainWindow.webContents.session.setPermissionCheckHandler(
    (_webContents, permission, requestingOrigin) => {
      if (isAutomationMode()) return false
      if (!mediaPermissions.has(permission)) return false
      return isTrustedRendererRequest(requestingOrigin)
    },
  )
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      if (isAutomationMode()) {
        callback(false)
        return
      }
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
    void mainWindow.loadURL(rendererUrlWithAutomationIdentity(rendererDevUrl))
  } else {
    void mainWindow.loadURL(
      rendererUrlWithAutomationIdentity(`${RENDERER_PROTOCOL_ORIGIN}/${INDEX_HTML}`),
    )
  }
}

function focusExistingWindow() {
  const existingWindow = getAllBrowserWindows()[0]
  if (!existingWindow) {
    return
  }

  focusWindow(existingWindow)
}

function registerAppLifecycle() {
  app
    .whenReady()
    .then(() => {
      electronApp.setAppUserModelId('com.openwaggle.app')
      configureDesktopUiAfterReady(app, appIconPath)

      // Initialize file logger now that app paths are available
      void initFileLogger(app.getPath('logs'))

      void bootstrapServicesAndWindow().catch((error: unknown) => {
        logger.error('Bootstrap failed; quitting for safety', describeError(error))
        app.exit(FAILURE_EXIT_CODE)
      })

      app.on('activate', () => {
        if (getAllBrowserWindows().length === 0) createWindow()
      })
    })
    .catch((error: unknown) => {
      logger.error('App startup failed before ready', describeError(error))
    })

  app.on('window-all-closed', () => {
    // Session terminals outlive window closes; shells die in the quit shutdown.
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('before-quit', (e) => {
    disposeAutoUpdaterOnce?.()
    if (!beforeQuitCleanupDone) {
      e.preventDefault()
      completeAppRuntimeShutdown({
        persistActiveRuns: persistActiveRunsBeforeQuit,
        disposeRuntime: async () => {
          await cleanupTerminalsOnce?.()
          await (await getRuntimeModule()).disposeAppRuntime()
        },
      })
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
  prepareDesktopUi(app)

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

if (!startMcpCliIfRequested(process.argv)) startApp()
