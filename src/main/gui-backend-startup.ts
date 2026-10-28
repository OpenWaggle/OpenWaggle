/**
 * The GUI's backend behind its window (A-F1, A-F2, maintainer decision 3): attach to or launch
 * the Session Host, hydrate Settings from it, start desktop services, then release the IPC gate.
 * The window is already open meanwhile, showing its skeleton.
 */
import type { GuiStartupStatus } from '@shared/types/gui-startup'
import { app } from 'electron'
import { invokeConfiguredHostUi } from './application/gui-session-command-router'
import { getAllBrowserWindows, isAutomationMode } from './desktop-ui'
import { env } from './env'
import { startErrorReporting } from './error-reporting'
import { startGuiAutoUpdater } from './gui-auto-updater'
import { releaseGuiBackendGate } from './gui-backend-gate'
import type * as GuiRuntimeModule from './gui-runtime'
import { type GuiStartupProgress, GuiStartupRestartRequiredError } from './gui-startup-coordinator'
import { applyInstallerUpdateChannelIntent } from './installer-update-channel-intent'
import {
  type GuiSessionHostLifecycle,
  prepareGuiSessionHostLifecycle,
} from './session-host/gui-session-host-lifecycle'
import type { StartupMark } from './startup-timing'
import type * as SettingsStore from './store/settings'
import { userFacingErrorDetail } from './utils/describe-error'

let sessionHostLifecycleOnce: GuiSessionHostLifecycle | null = null
let cleanupDesktopServicesOnce: (() => Promise<void>) | null = null

/** The Host lifecycle once a start prepared it; quit stops it. */
export function guiSessionHostLifecycle() {
  return sessionHostLifecycleOnce
}

/** Releases desktop services once they started; quit runs it. */
export function guiDesktopServicesCleanup() {
  return cleanupDesktopServicesOnce
}

export function clearGuiBackend() {
  sessionHostLifecycleOnce = null
  cleanupDesktopServicesOnce = null
}

async function hydrateSettingsFromHost(settingsStore: typeof SettingsStore) {
  await applyInstallerUpdateChannelIntent(app.getPath('userData'), async (channel) => {
    const update = await invokeConfiguredHostUi('settings:update', [{ updateChannel: channel }])
    if (!update.handled) throw new Error('Attached GUI lost its Session Host settings route.')
  })
  const automationProjectPath = isAutomationMode() ? env.OPENWAGGLE_AUTOMATION_PROJECT_PATH : null
  if (automationProjectPath) {
    const patch = { projectPath: automationProjectPath, recentProjects: [automationProjectPath] }
    const update = await invokeConfiguredHostUi('settings:update', [patch])
    if (!update.handled) throw new Error('Attached GUI lost its Session Host settings route.')
  }
  const settings = await invokeConfiguredHostUi('settings:get', [])
  if (!settings.handled) throw new Error('Attached GUI lost its Session Host settings route.')
  settingsStore.hydrateSettingsStoreFromHost(settings.result)
}

/**
 * Brings the backend up behind the window (A-F1, A-F2): attach to or launch the Session Host,
 * hydrate Settings from it, start desktop services, then release the IPC gate. The Host launch
 * starts first, so its own startup overlaps everything else in this process.
 */
export async function startGuiBackend(input: {
  readonly progress: GuiStartupProgress
  readonly signal: AbortSignal
  readonly onHostUnderway: () => void
  /** Settles once the Host process is launched or reached, or after a short bound. */
  readonly hostHeadStart: Promise<void>
  readonly startupMark: StartupMark
  readonly loadRuntime: () => Promise<typeof GuiRuntimeModule>
}) {
  const { startupMark } = input
  const { signal } = input
  if (!sessionHostLifecycleOnce) {
    sessionHostLifecycleOnce = await prepareGuiSessionHostLifecycle({
      userDataRoot: app.getPath('userData'),
      clientVersion: app.getVersion(),
      startupMark,
      onUpgradePending: input.progress.updating,
      onHostUnderway: input.onHostUnderway,
    })
  }
  const lifecycle = sessionHostLifecycleOnce
  const hostStart = lifecycle.start(signal)
  // Unhandled until awaited below; a rejection is not lost meanwhile.
  hostStart.catch(() => undefined)
  // Loading this process's runtime keeps the thread busy, so the Host launch goes first.
  await input.hostHeadStart
  // Meanwhile this process prepares its own runtime, which the Host start does not need.
  const [runtimeModule, settingsStoreModule] = await Promise.all([
    input.loadRuntime(),
    import('./store/settings'),
  ])
  startupMark('startup-modules-imported')
  // The window's own composition root (A-F5): no Pi, MCP, agent kernel, SQLite or model runtime.
  await runtimeModule.initializeGuiRuntime()
  startupMark('gui-runtime-initialized')
  await hostStart
  try {
    signal.throwIfAborted()
    await hydrateSettingsFromHost(settingsStoreModule)
    startupMark('settings-store-hydrated-from-host')
    signal.throwIfAborted()
  } catch (error) {
    // Detach, so a Retry attaches once more instead of beside this attachment.
    await lifecycle.stop().catch(() => undefined)
    throw error
  }
  // Settings decide whether errors are reported; the window's switch did not wait (A-F16).
  void startErrorReporting('gui')
  const usageStatisticsModule = await import('./usage-statistics/usage-statistics-gui')
  usageStatisticsModule.startGuiUsageStatistics()

  // Desktop services start without the login-shell probe: terminals, project actions and git
  // wait for `desktopShellEnvironmentReady()` before they start a process (A-F7).
  if (!cleanupDesktopServicesOnce) {
    const { startAppGuiDesktopServices } = await import('./gui-desktop-services')
    try {
      cleanupDesktopServicesOnce = await startAppGuiDesktopServices({
        client: lifecycle.client,
        runEffect: runtimeModule.runGuiEffect,
        disposeRuntime: runtimeModule.disposeGuiRuntime,
      })
    } catch (error) {
      // Its cleanup already disposed this process's runtime: only a new process can retry.
      throw new GuiStartupRestartRequiredError(error)
    }
  }
  startupMark('desktop-native-ownership-reconciled')
  releaseGuiBackendGate()
  startupMark('gui-backend-ready')
  if (!isAutomationMode()) void startGuiAutoUpdater()
}

export function publishStartupStatus(startupMark: StartupMark, status: GuiStartupStatus) {
  startupMark(`startup-status-${status.state}`)
  for (const window of getAllBrowserWindows()) {
    window.webContents.send('app:startup-status-changed', status)
  }
}

export function describeStartupFailure(error: unknown) {
  const failure = error instanceof GuiStartupRestartRequiredError ? error.failure : error
  return userFacingErrorDetail(failure instanceof Error ? failure.message : String(failure))
}
