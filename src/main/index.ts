import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
// Must be first: renames dev builds before any module reads app userData.
import './apply-build-identity'
import './restore-host-temporary-directory' // before any module caches a temp path
import './apply-pi-package-directory' // before any Pi module reads its package.json
import { electronApp, is } from '@electron-toolkit/utils'
import { MAC_DEV_DOCK_ICON_FILE } from '@shared/build-identity-runtime'
import { app, session } from 'electron'
import {
  configureDefaultSessionEmbeddingModelForPackagedRuntime,
  SESSION_EMBEDDING_MODEL_RESOURCE_DIRECTORY,
} from './adapters/multilingual-e5-session-embedding-model'
import { registerAppQuitCleanup } from './app-quit-cleanup'
import { readInlineVisualizationSource } from './application/inline-visualization-source-service'
import { applicationCliArguments } from './application-cli-arguments'
import { registerApplicationProtocols } from './application-protocols'
import { watchChromiumCacheSize } from './chromium-disk-cache'
import { shellEnvironmentCacheFile } from './desktop-shell-environment-cache'
import { getAllBrowserWindows, isAutomationMode } from './desktop-ui'
import { configureDesktopUiAfterReady, prepareDesktopUi } from './desktop-window-policy'
import { env, installDesktopShellEnvironment } from './env'
import { describeError } from './error-description'
import { disposeGuiAutoUpdater, isGuiInstallingUpdate } from './gui-auto-updater'
import { holdGuiBackendGate } from './gui-backend-gate'
import {
  clearGuiBackend,
  describeStartupFailure,
  guiDesktopServicesCleanup,
  guiSessionHostLifecycle,
  publishStartupStatus,
  startGuiBackend,
} from './gui-backend-startup'
import { exitAfterBootstrapFailure, reportGuiStartupFailure } from './gui-bootstrap-failure'
import { createGuiStartupCoordinator, type GuiStartupCoordinator } from './gui-startup-coordinator'
import { openWindowThenRegisterIpc } from './gui-window-bootstrap'
import { installInlineVisualizationNavigationGuard } from './inline-visualization-navigation'
import { createLogger, initFileLogger } from './logger'
import { createMainWindow, focusExistingWindow } from './main-window'
import { claimAppInstance } from './open-project-requests'
import {
  configureInlineVisualizationProcessIsolation,
  registerRendererScheme,
} from './renderer-protocol'
import { beginAppCliShimSetupWhen } from './services/cli-shim-startup'
import { setAppDatabaseAccessMode } from './services/database-access-mode'
import { configureAppStoragePaths } from './session-data'
import { hasSessionHostPrelaunch } from './session-host/session-host-prelaunch-handoff'
import { forwardSessionLinksFromBackgroundProcess } from './session-link-forwarding'
import { installSessionLinkProtocol } from './session-link-protocol'
import { requestOpenSessionLink } from './session-link-requests'
import { createStartupMark } from './startup-timing'
import { startTopLevelCli, type TopLevelCliLaunch } from './top-level-cli-entry'

const FAILURE_EXIT_CODE = 1
const AUTOMATION_SECOND_INSTANCE_EXIT_GRACE_MS = 5_000
/** At most this long the window waits for the Host process to be launched or reached. */
const HOST_LAUNCH_HEAD_START_MAX_MS = 150
const AUTOMATION_SINGLE_INSTANCE_LOCK_DENIED_MARKER_SWITCH =
  'openwaggle-automation-single-instance-lock-denied-marker'
const AUTOMATION_SINGLE_INSTANCE_LOCK_DENIED_MARKER_CONTENT = 'single-instance-lock-denied\n'

const importAgentHandlerModule = () => import('./ipc/agent-handler')
const importIpcHandlersModule = () => import('./ipc/handlers')
const importRuntimeModule = () => import('./gui-runtime')

type AgentHandlerModule = Awaited<ReturnType<typeof importAgentHandlerModule>>
type IpcHandlersModule = Awaited<ReturnType<typeof importIpcHandlersModule>>
type RuntimeModule = Awaited<ReturnType<typeof importRuntimeModule>>

configureInlineVisualizationProcessIsolation()
registerRendererScheme()

if (app.isPackaged) {
  configureDefaultSessionEmbeddingModelForPackagedRuntime(
    join(process.resourcesPath, SESSION_EMBEDDING_MODEL_RESOURCE_DIRECTORY),
  )
}

const appIconPath = is.dev
  ? join(__dirname, '../../build/icon-dev.png')
  : join(process.resourcesPath, 'icon.png')
// Unpackaged builds have no bundle icon, so macOS takes their Dock icon at runtime; use the
// generated rounded-square macOS icon rather than the free-form window icon.
const devDockIconPath = join(__dirname, '../../build', MAC_DEV_DOCK_ICON_FILE)
const logger = createLogger('main/index')
let ipcHandlersRegistered = false
let mainWindowCreated = false
let cleanupTerminalsOnce: IpcHandlersModule['cleanupTerminals'] | null = null
let persistAllActiveRunsOnce: AgentHandlerModule['persistAllActiveRuns'] | null = null
let runtimeModulePromise: Promise<RuntimeModule> | null = null

const startupMark = createStartupMark('main/index')

function quitAutomationSecondInstance() {
  const markerPath = app.commandLine.getSwitchValue(
    AUTOMATION_SINGLE_INSTANCE_LOCK_DENIED_MARKER_SWITCH,
  )
  if (!markerPath) {
    logger.error('Automation second-instance probe omitted its lock-denied marker path')
    app.exit(FAILURE_EXIT_CODE)
    return
  }
  void writeFile(markerPath, AUTOMATION_SINGLE_INSTANCE_LOCK_DENIED_MARKER_CONTENT, {
    flag: 'wx',
  }).then(
    () => setTimeout(() => app.quit(), AUTOMATION_SECOND_INSTANCE_EXIT_GRACE_MS),
    (error: unknown) => {
      logger.error('Automation second-instance lock-denied marker failed', describeError(error))
      app.exit(FAILURE_EXIT_CODE)
    },
  )
}

function getRuntimeModule() {
  runtimeModulePromise ??= importRuntimeModule()
  return runtimeModulePromise
}
async function registerIpcHandlersOnce(startup: GuiStartupCoordinator) {
  if (ipcHandlersRegistered) {
    logger.warn('Skipping duplicate IPC handler registration')
    return
  }

  const [ipcHandlersModule, agentHandlerModule, startupHandlerModule] = await Promise.all([
    importIpcHandlersModule(),
    importAgentHandlerModule(),
    import('./ipc/startup-handler'),
  ])

  ipcHandlersRegistered = true
  cleanupTerminalsOnce = ipcHandlersModule.cleanupTerminals
  persistAllActiveRunsOnce = agentHandlerModule.persistAllActiveRuns

  startupHandlerModule.registerStartupHandlers(startup)
  // Registered before the backend is ready; they wait at the backend gate until it is.
  ipcHandlersModule.registerAllIpcHandlers()
}

async function persistActiveRunsBeforeQuit() {
  const [runtimeModule, agentHandlerModule] = await Promise.all([
    getRuntimeModule(),
    persistAllActiveRunsOnce ? Promise.resolve(null) : importAgentHandlerModule(),
  ])
  const resolved = persistAllActiveRunsOnce ?? agentHandlerModule?.persistAllActiveRuns ?? null
  if (!resolved) return

  await runtimeModule.runGuiEffect(resolved())
}

async function bootstrapServicesAndWindow() {
  startupMark('bootstrap-start')
  // Never awaited by startup: terminals, project actions and git wait for it themselves (A-F7).
  void installDesktopShellEnvironment({
    cacheFile: shellEnvironmentCacheFile(app.getPath('userData')),
  }).refreshed.then(
    () => startupMark('desktop-shell-environment-refreshed'),
    (error: unknown) => {
      logger.warn('The login-shell environment could not be read', describeError(error))
    },
  )
  // The window has no database of its own; Settings come from the Host (A-F5).
  setAppDatabaseAccessMode('client-isolated')

  // Renderer requests wait here until the backend is ready (A-F2).
  holdGuiBackendGate()
  const hostUnderway = Promise.withResolvers<void>()
  // A Host the boot shim launched is under way already; the window need not wait for it.
  const hostHeadStart = hasSessionHostPrelaunch()
    ? Promise.resolve()
    : Promise.race([hostUnderway.promise, delay(HOST_LAUNCH_HEAD_START_MAX_MS)])
  const startup = createGuiStartupCoordinator({
    start: (progress, signal) =>
      startGuiBackend({
        progress,
        signal,
        onHostUnderway: hostUnderway.resolve,
        hostHeadStart,
        startupMark,
        loadRuntime: getRuntimeModule,
      }),
    publish: (status) => publishStartupStatus(startupMark, status),
    onFailure: reportGuiStartupFailure,
    describeFailure: describeStartupFailure,
    restart: () => {
      app.relaunch()
      app.quit()
    },
  })
  // The Host launch starts now, in parallel with the window (A-F1). Its process is spawned
  // before this one evaluates the IPC handlers and opens the window, which keep its thread busy;
  // a Host that takes longer to reach (an update hand-off) does not hold the window back.
  startup.run()
  await hostHeadStart
  startupMark('session-host-underway')

  await openWindowThenRegisterIpc({
    registerProtocols: () =>
      registerApplicationProtocols({
        readInlineVisualizationSource: async (input) =>
          (await getRuntimeModule()).runGuiEffect(readInlineVisualizationSource(input)),
      }),
    createWindow: () => {
      createMainWindowWithVisualizationGuard()
      mainWindowCreated = true
    },
    registerIpc: async () => {
      await getRuntimeModule()
      await registerIpcHandlersOnce(startup)
    },
    startupMark,
  })
}

/** A later launch focuses the window, or creates one after startup as the Dock icon does. */
function revealMainWindow() {
  if (getAllBrowserWindows().length > 0 || !mainWindowCreated) focusExistingWindow()
  else createMainWindowWithVisualizationGuard()
}

function createMainWindowWithVisualizationGuard() {
  createMainWindow({ appIconPath, startupMark })
  const mainWindow = getAllBrowserWindows()[0]
  if (mainWindow) installInlineVisualizationNavigationGuard(mainWindow.webContents)
}

function registerAppLifecycle() {
  app
    .whenReady()
    .then(() => {
      electronApp.setAppUserModelId('com.openwaggle.app')
      configureDesktopUiAfterReady(app, devDockIconPath)

      // Initialize file logger now that app paths are available
      void initFileLogger(app.getPath('logs'))
      watchChromiumCacheSize(session.defaultSession)

      // CLI recovery must remain available even if the Session Host or window cannot start.
      const cliSetup = beginAppCliShimSetupWhen(app.isPackaged && !isAutomationMode())

      void bootstrapServicesAndWindow().catch((error: unknown) =>
        exitAfterBootstrapFailure({
          error,
          cliSetup,
          cleanupDesktopServices: async () => guiDesktopServicesCleanup()?.(),
          exit: (code) => app.exit(code),
        }),
      )

      app.on('activate', () => {
        if (getAllBrowserWindows().length === 0) {
          createMainWindowWithVisualizationGuard()
        }
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

  registerAppQuitCleanup({
    disposeAutoUpdater: disposeGuiAutoUpdater,
    persistActiveRuns: persistActiveRunsBeforeQuit,
    cleanupTerminals: async () => {
      const cleanupDesktopServices = guiDesktopServicesCleanup()
      if (cleanupDesktopServices) await cleanupDesktopServices()
      else await cleanupTerminalsOnce?.()
    },
    disposeRuntime: async () => {
      try {
        // The installer cannot replace the app while its detached Host still runs (ADR 0047).
        await guiSessionHostLifecycle()?.stop({
          releaseHostForUpdate: isGuiInstallingUpdate(),
        })
      } finally {
        try {
          await (await getRuntimeModule()).disposeGuiRuntime()
        } finally {
          clearGuiBackend()
        }
      }
    },
  })
}

function startApp(launch: Extract<TopLevelCliLaunch, { readonly kind: 'gui' }>) {
  configureAppStoragePaths(app, env.OPENWAGGLE_USER_DATA_DIR)
  prepareDesktopUi(app)

  const singleInstance = env.OPENWAGGLE_DISABLE_SINGLE_INSTANCE !== '1'
  const instance = { host: app, ...launch, singleInstance, revealWindow: revealMainWindow }
  if (claimAppInstance(instance) === 'secondary') {
    logger.warn('Another OpenWaggle instance is already running; quitting this instance')
    if (env.OPENWAGGLE_AUTOMATION === '1') quitAutomationSecondInstance()
    else app.quit()
    return
  }

  installSessionLinkProtocol({
    host: app,
    automation: isAutomationMode(),
    openLink: (url) => {
      if (requestOpenSessionLink(url)) revealMainWindow()
    },
  })
  registerAppLifecycle()
}

const cliArguments = applicationCliArguments(process.argv, { isPackaged: app.isPackaged })

const launch = startTopLevelCli(cliArguments)
if (launch.kind === 'gui') startApp(launch)
else forwardSessionLinksFromBackgroundProcess(app)
