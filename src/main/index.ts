import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { electronApp, is } from '@electron-toolkit/utils'
import { app } from 'electron'
import { startAccessCliIfRequested } from './access-cli-entry'
import {
  configureDefaultSessionEmbeddingModelForPackagedRuntime,
  SESSION_EMBEDDING_MODEL_RESOURCE_DIRECTORY,
} from './adapters/multilingual-e5-session-embedding-model'
import { startAgentsCliIfRequested } from './agents-cli-entry'
import { registerAppQuitCleanup } from './app-quit-cleanup'
import { invokeConfiguredHostUi } from './application/gui-session-command-router'
import { readInlineVisualizationSource } from './application/inline-visualization-source-service'
import { applicationCliArguments } from './application-cli-arguments'
import { startDelegationsCliIfRequested } from './delegations-cli-entry'
import { getAllBrowserWindows, isAutomationMode } from './desktop-ui'
import { configureDesktopUiAfterReady, prepareDesktopUi } from './desktop-window-policy'
import { env, installDesktopShellEnvironment } from './env'
import { describeError } from './error-description'
import { registerExtensionFrameProtocolOnce } from './extension-frame-protocol'
import { registerExtensionRuntimeProtocolOnce } from './extension-runtime-protocol'
import { installInlineVisualizationNavigationGuard } from './inline-visualization-navigation'
import { registerInlineVisualizationProtocolOnce } from './inline-visualization-protocol'
import { createLogger, initFileLogger } from './logger'
import { createMainWindow, focusExistingWindow } from './main-window'
import { startMcpCliIfRequested } from './mcp-cli-entry'
import { startRecoveryCliIfRequested } from './recovery-cli-entry'
import {
  configureInlineVisualizationProcessIsolation,
  registerRendererProtocolOnce,
  registerRendererScheme,
} from './renderer-protocol'
import { configureAppStoragePaths } from './session-data'
import {
  type GuiSessionHostLifecycle,
  prepareGuiSessionHostLifecycle,
} from './session-host/gui-session-host-lifecycle'
import { startSessionHostCliIfRequested } from './session-host-cli-entry'
import { startSessionsCliIfRequested } from './sessions-cli-entry'

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
  ? join(__dirname, '../../build/icon.png')
  : join(process.resourcesPath, 'icon.png')
const logger = createLogger('main/index')
const startupStartedAt = performance.now()
let ipcHandlersRegistered = false
let cleanupTerminalsOnce: IpcHandlersModule['cleanupTerminals'] | null = null
let disposeAutoUpdaterOnce: (() => void) | null = null
let persistAllActiveRunsOnce: AgentHandlerModule['persistAllActiveRuns'] | null = null
let runtimeModulePromise: Promise<RuntimeModule> | null = null
let sessionHostLifecycleOnce: GuiSessionHostLifecycle | null = null
let cleanupDesktopServicesOnce: (() => Promise<void>) | null = null

function startupMark(label: string) {
  if (!app.commandLine.hasSwitch(STARTUP_TIMINGS_SWITCH)) {
    return
  }

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

  if (automationProjectPatch) {
    const update = await invokeConfiguredHostUi('settings:update', [automationProjectPatch])
    if (!update.handled) throw new Error('Attached GUI lost its Session Host settings route.')
  }
  const settings = await invokeConfiguredHostUi('settings:get', [])
  if (!settings.handled) throw new Error('Attached GUI lost its Session Host settings route.')
  settingsStoreModule.hydrateSettingsStoreFromHost(settings.result)
  startupMark('settings-store-hydrated-from-host')

  const { startAppGuiDesktopServices } = await import('./gui-desktop-services')
  cleanupDesktopServicesOnce = await startAppGuiDesktopServices({
    client: sessionHostLifecycleOnce.client,
    runEffect: runtimeModule.runAppEffect,
    disposeRuntime: runtimeModule.disposeAppRuntime,
  })
  startupMark('desktop-native-ownership-reconciled')

  await registerIpcHandlersOnce()
  startupMark('ipc-handlers-registered')

  registerRendererProtocolOnce()
  registerExtensionFrameProtocolOnce()
  registerExtensionRuntimeProtocolOnce()
  registerInlineVisualizationProtocolOnce({
    readSource: (input) => runtimeModule.runAppEffect(readInlineVisualizationSource(input)),
  })
  startupMark('protocol-handlers-registered')

  createMainWindowWithVisualizationGuard()
  startupMark('main-window-created')

  if (!isAutomationMode()) void initializeAutoUpdaterAfterWindow()
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

      void bootstrapServicesAndWindow().catch(async (error: unknown) => {
        logger.error('Bootstrap failed; quitting for safety', describeError(error))
        try {
          await cleanupDesktopServicesOnce?.()
        } catch (cleanupError) {
          logger.error(
            'Bootstrap native cleanup failed; ownership remains quarantined',
            describeError(cleanupError),
          )
        }
        app.exit(FAILURE_EXIT_CODE)
      })

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

function startApp() {
  configureAppStoragePaths(app, env.OPENWAGGLE_USER_DATA_DIR)
  prepareDesktopUi(app)

  if (env.OPENWAGGLE_DISABLE_SINGLE_INSTANCE !== '1') {
    if (!app.requestSingleInstanceLock()) {
      logger.warn('Another OpenWaggle instance is already running; quitting this instance')
      if (env.OPENWAGGLE_AUTOMATION === '1') {
        quitAutomationSecondInstance()
      } else {
        app.quit()
      }
      return
    }
    app.on('second-instance', focusExistingWindow)
  }

  registerAppLifecycle()
}

const cliArguments = applicationCliArguments(process.argv, { isPackaged: app.isPackaged })

if (
  !startSessionHostCliIfRequested(cliArguments) &&
  !startAccessCliIfRequested(cliArguments) &&
  !startSessionsCliIfRequested(cliArguments) &&
  !startDelegationsCliIfRequested(cliArguments) &&
  !startAgentsCliIfRequested(cliArguments) &&
  !startRecoveryCliIfRequested(cliArguments) &&
  !startMcpCliIfRequested(cliArguments)
) {
  startApp()
}
