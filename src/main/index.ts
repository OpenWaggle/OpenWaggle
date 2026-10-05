import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
// Must be first: renames dev builds before any module reads app userData.
import './apply-build-identity'
import './restore-host-temporary-directory' // before any module caches a temp path
import { electronApp, is } from '@electron-toolkit/utils'
import { app } from 'electron'
import {
  configureDefaultSessionEmbeddingModelForPackagedRuntime,
  SESSION_EMBEDDING_MODEL_RESOURCE_DIRECTORY,
} from './adapters/multilingual-e5-session-embedding-model'
import { registerAppQuitCleanup } from './app-quit-cleanup'
import { invokeConfiguredHostUi } from './application/gui-session-command-router'
import { readInlineVisualizationSource } from './application/inline-visualization-source-service'
import { openSessionResourceContentStream } from './application/session-resource-content'
import { applicationCliArguments } from './application-cli-arguments'
import { registerApplicationProtocols } from './application-protocols'
import { getAllBrowserWindows, isAutomationMode } from './desktop-ui'
import { configureDesktopUiAfterReady, prepareDesktopUi } from './desktop-window-policy'
import { env, installDesktopShellEnvironment } from './env'
import { describeError } from './error-description'
import { startErrorReporting } from './error-reporting'
import { exitAfterBootstrapFailure } from './gui-bootstrap-failure'
import { installInlineVisualizationNavigationGuard } from './inline-visualization-navigation'
import { applyInstallerUpdateChannelIntent } from './installer-update-channel-intent'
import { createLogger, initFileLogger } from './logger'
import { createMainWindow, focusExistingWindow } from './main-window'
import { claimAppInstance } from './open-project-requests'
import {
  configureInlineVisualizationProcessIsolation,
  registerRendererScheme,
} from './renderer-protocol'
import { beginAppCliShimSetupWhen } from './services/cli-shim-startup'
import { configureAppStoragePaths } from './session-data'
import {
  type GuiSessionHostLifecycle,
  prepareGuiSessionHostLifecycle,
} from './session-host/gui-session-host-lifecycle'
import { startTopLevelCli } from './top-level-cli-entry'

const FAILURE_EXIT_CODE = 1
const STARTUP_TIMINGS_SWITCH = 'openwaggle-startup-timings'
const STARTUP_TIMING_PRECISION = 1
const AUTOMATION_SECOND_INSTANCE_EXIT_GRACE_MS = 5_000
const AUTOMATION_SINGLE_INSTANCE_LOCK_DENIED_MARKER_SWITCH =
  'openwaggle-automation-single-instance-lock-denied-marker'
const AUTOMATION_SINGLE_INSTANCE_LOCK_DENIED_MARKER_CONTENT = 'single-instance-lock-denied\n'

const importAgentHandlerModule = () => import('./ipc/agent-handler')
const importIpcHandlersModule = () => import('./ipc/handlers')
const importRuntimeModule = () => import('./runtime')
const importSettingsStoreModule = () => import('./store/settings')
const importUpdaterModule = () => import('./updater')

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
const logger = createLogger('main/index')
const startupStartedAt = performance.now()
let ipcHandlersRegistered = false
let mainWindowCreated = false
let cleanupTerminalsOnce: IpcHandlersModule['cleanupTerminals'] | null = null
let disposeAutoUpdaterOnce: (() => void) | null = null
let persistAllActiveRunsOnce: AgentHandlerModule['persistAllActiveRuns'] | null = null
let runtimeModulePromise: Promise<RuntimeModule> | null = null
let sessionHostLifecycleOnce: GuiSessionHostLifecycle | null = null
let cleanupDesktopServicesOnce: (() => Promise<void>) | null = null

function startupMark(label: string) {
  if (!app.commandLine.hasSwitch(STARTUP_TIMINGS_SWITCH)) return

  logger.info('Startup timing', {
    label,
    elapsedMs: Number((performance.now() - startupStartedAt).toFixed(STARTUP_TIMING_PRECISION)),
  })
}

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
async function registerIpcHandlersOnce() {
  if (ipcHandlersRegistered) {
    logger.warn('Skipping duplicate IPC handler registration')
    return
  }

  const [ipcHandlersModule, agentHandlerModule, usageStatisticsModule] = await Promise.all([
    importIpcHandlersModule(),
    importAgentHandlerModule(),
    import('./usage-statistics/usage-statistics-gui'),
  ])

  ipcHandlersRegistered = true
  cleanupTerminalsOnce = ipcHandlersModule.cleanupTerminals
  persistAllActiveRunsOnce = agentHandlerModule.persistAllActiveRuns

  // Settings are hydrated from the Host by now; handlers record GUI-only observations here.
  usageStatisticsModule.startGuiUsageStatistics()
  ipcHandlersModule.registerAllIpcHandlers()
}

async function initializeAutoUpdaterAfterWindow() {
  try {
    const { disposeAutoUpdater, initAutoUpdater } = await importUpdaterModule()
    disposeAutoUpdaterOnce = disposeAutoUpdater
    const { getSettings, hydrateSettingsStoreFromHost } = await importSettingsStoreModule()
    initAutoUpdater(getSettings().updateChannel, async () => {
      const settings = await invokeConfiguredHostUi('settings:get', [])
      if (!settings.handled) throw new Error('Attached GUI lost its Session Host settings route.')
      hydrateSettingsStoreFromHost(settings.result)
      return getSettings().updateChannel
    })
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

  sessionHostLifecycleOnce = await prepareGuiSessionHostLifecycle({
    userDataRoot: app.getPath('userData'),
    clientVersion: app.getVersion(),
    startupMark,
  })

  const { configureAppDatabaseAccess } = await import('./services/database-service')
  configureAppDatabaseAccess('client-isolated')

  const [runtimeModule, settingsStoreModule] = await Promise.all([
    getRuntimeModule(),
    importSettingsStoreModule(),
    installDesktopShellEnvironment(),
  ])
  startupMark('desktop-shell-environment-installed')
  startupMark('startup-modules-imported')

  await runtimeModule.initializeAppRuntime()
  startupMark('app-runtime-initialized')

  await settingsStoreModule.initializeSettingsStore()
  startupMark('settings-store-initialized')

  const automationProjectPatch =
    isAutomationMode() && env.OPENWAGGLE_AUTOMATION_PROJECT_PATH
      ? {
          projectPath: env.OPENWAGGLE_AUTOMATION_PROJECT_PATH,
          recentProjects: [env.OPENWAGGLE_AUTOMATION_PROJECT_PATH],
        }
      : null

  await sessionHostLifecycleOnce.start()

  await applyInstallerUpdateChannelIntent(app.getPath('userData'), async (channel) => {
    const update = await invokeConfiguredHostUi('settings:update', [{ updateChannel: channel }])
    if (!update.handled) throw new Error('Attached GUI lost its Session Host settings route.')
  })

  if (automationProjectPatch) {
    const update = await invokeConfiguredHostUi('settings:update', [automationProjectPatch])
    if (!update.handled) throw new Error('Attached GUI lost its Session Host settings route.')
  }
  const settings = await invokeConfiguredHostUi('settings:get', [])
  if (!settings.handled) throw new Error('Attached GUI lost its Session Host settings route.')
  settingsStoreModule.hydrateSettingsStoreFromHost(settings.result)
  startupMark('settings-store-hydrated-from-host')
  // Settings decide whether errors are reported; the main window must know before it opens.
  const errorReportingStart = startErrorReporting('gui')

  const { startAppGuiDesktopServices } = await import('./gui-desktop-services')
  cleanupDesktopServicesOnce = await startAppGuiDesktopServices({
    client: sessionHostLifecycleOnce.client,
    runEffect: runtimeModule.runAppEffect,
    disposeRuntime: runtimeModule.disposeAppRuntime,
  })
  startupMark('desktop-native-ownership-reconciled')

  await registerIpcHandlersOnce()
  startupMark('ipc-handlers-registered')

  registerApplicationProtocols({
    readInlineVisualizationSource: (input) =>
      runtimeModule.runAppEffect(readInlineVisualizationSource(input)),
    readSessionResourceContent: (input) =>
      runtimeModule.runAppEffect(
        openSessionResourceContentStream(input.sessionId, input.resourceId),
      ),
  })
  startupMark('protocol-handlers-registered')

  await errorReportingStart
  createMainWindowWithVisualizationGuard()
  mainWindowCreated = true
  startupMark('main-window-created')

  if (!isAutomationMode()) void initializeAutoUpdaterAfterWindow()
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
      configureDesktopUiAfterReady(app, appIconPath)

      // Initialize file logger now that app paths are available
      void initFileLogger(app.getPath('logs'))

      // CLI recovery must remain available even if the Session Host or window cannot start.
      const cliSetup = beginAppCliShimSetupWhen(app.isPackaged && !isAutomationMode())

      void bootstrapServicesAndWindow().catch((error: unknown) =>
        exitAfterBootstrapFailure({
          error,
          cliSetup,
          cleanupDesktopServices: async () => cleanupDesktopServicesOnce?.(),
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
    disposeAutoUpdater: () => disposeAutoUpdaterOnce?.(),
    persistActiveRuns: persistActiveRunsBeforeQuit,
    cleanupTerminals: async () => {
      if (cleanupDesktopServicesOnce) await cleanupDesktopServicesOnce()
      else await cleanupTerminalsOnce?.()
    },
    disposeRuntime: async () => {
      try {
        await sessionHostLifecycleOnce?.stop()
      } finally {
        try {
          await (await getRuntimeModule()).disposeAppRuntime()
        } finally {
          sessionHostLifecycleOnce = null
          cleanupDesktopServicesOnce = null
        }
      }
    },
  })
}

function startApp(openProjectPath?: string) {
  configureAppStoragePaths(app, env.OPENWAGGLE_USER_DATA_DIR)
  prepareDesktopUi(app)

  const singleInstance = env.OPENWAGGLE_DISABLE_SINGLE_INSTANCE !== '1'
  const instance = { host: app, openProjectPath, singleInstance, revealWindow: revealMainWindow }
  if (claimAppInstance(instance) === 'secondary') {
    logger.warn('Another OpenWaggle instance is already running; quitting this instance')
    if (env.OPENWAGGLE_AUTOMATION === '1') quitAutomationSecondInstance()
    else app.quit()
    return
  }

  registerAppLifecycle()
}

const cliArguments = applicationCliArguments(process.argv, { isPackaged: app.isPackaged })

const launch = startTopLevelCli(cliArguments)
if (launch.kind === 'gui') startApp(launch.openProjectPath)
