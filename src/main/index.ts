import { join } from 'node:path'
import { electronApp, is } from '@electron-toolkit/utils'
import { app } from 'electron'
import { startAccessCliIfRequested } from './access-cli-entry'
import {
  configureDefaultSessionEmbeddingModelForPackagedRuntime,
  SESSION_EMBEDDING_MODEL_RESOURCE_DIRECTORY,
} from './adapters/multilingual-e5-session-embedding-model'
import { startAgentsCliIfRequested } from './agents-cli-entry'
import { completeAppRuntimeShutdown } from './application/app-runtime-shutdown'
import { applicationCliArguments } from './application-cli-arguments'
import { startDelegationsCliIfRequested } from './delegations-cli-entry'
import { getAllBrowserWindows, isAutomationMode } from './desktop-ui'
import { configureDesktopUiAfterReady, prepareDesktopUi } from './desktop-window-policy'
import { env } from './env'
import { describeError } from './error-description'
import { registerExtensionFrameProtocolOnce } from './extension-frame-protocol'
import { registerExtensionRuntimeProtocolOnce } from './extension-runtime-protocol'
import { createLogger, initFileLogger } from './logger'
import { createMainWindow, focusExistingWindow } from './main-window'
import { startMcpCliIfRequested } from './mcp-cli-entry'
import { startRecoveryCliIfRequested } from './recovery-cli-entry'
import { registerRendererProtocolOnce, registerRendererScheme } from './renderer-protocol'
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
let beforeQuitCleanupDone = false
let cleanupTerminalsOnce: IpcHandlersModule['cleanupTerminals'] | null = null
let disposeAutoUpdaterOnce: (() => void) | null = null
let persistAllActiveRunsOnce: AgentHandlerModule['persistAllActiveRuns'] | null = null
let runtimeModulePromise: Promise<RuntimeModule> | null = null
let sessionHostLifecycleOnce: GuiSessionHostLifecycle | null = null

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

  sessionHostLifecycleOnce = await prepareGuiSessionHostLifecycle({
    userDataRoot: app.getPath('userData'),
    clientVersion: app.getVersion(),
    startupMark,
    requestShutdownForHandoff: () => app.quit(),
  })

  const { configureAppDatabaseAccess } = await import('./services/database-service')
  configureAppDatabaseAccess(sessionHostLifecycleOnce.databaseAccess)

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

  const sessionHostMode = await sessionHostLifecycleOnce.start({
    runEffect: runtimeModule.runAppEffect,
    startOwnedServices: runtimeModule.startSessionHostOwnedServices,
    stopOwnedServices: runtimeModule.stopSessionHostOwnedServices,
  })

  if (sessionHostMode === 'owned') {
    await runtimeModule.runAppEffect(agentRunServiceModule.reconcileInterruptedAgentRuns())
  }
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
  startupMark('protocol-handlers-registered')

  createMainWindow({ appIconPath, startupMark })
  startupMark('main-window-created')

  if (!isAutomationMode()) void initializeAutoUpdaterAfterWindow()
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
        if (getAllBrowserWindows().length === 0) {
          createMainWindow({ appIconPath, startupMark })
        }
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
      completeAppRuntimeShutdown({
        persistActiveRuns: persistActiveRunsBeforeQuit,
        disposeRuntime: async () => {
          const sessionHostLifecycle = sessionHostLifecycleOnce
          try {
            await sessionHostLifecycle?.stop()
          } finally {
            try {
              await (await getRuntimeModule()).disposeAppRuntime()
            } finally {
              await sessionHostLifecycle?.releaseOwnership()
              sessionHostLifecycleOnce = null
            }
          }
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
