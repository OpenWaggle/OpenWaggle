import { Effect, Layer } from 'effect'
import { ElectronBrowserPreviewAutomationServiceLive } from './adapters/electron-browser-preview-automation-service'
import { NodePtyTerminalServiceLive } from './adapters/node-pty-terminal-service'
import { makeOfflineDesktopCleanupExecutor } from './adapters/offline-desktop-cleanup'
import { RemoteBrowserPreviewAutomationServiceLive } from './adapters/remote-browser-preview-automation-service'
import { RemoteTerminalServiceLive } from './adapters/remote-terminal-service'
import { SqliteDesktopFenceRepositoryLive } from './adapters/sqlite-desktop-fence-repository'
import { SqliteDesktopOwnerRepositoryLive } from './adapters/sqlite-desktop-owner-repository'
import { terminalHistoryDirectory } from './adapters/terminal/terminal-history-directory'
import { makeDesktopServiceBroker } from './application/desktop-service-broker'
import { DesktopFenceRepository } from './ports/desktop-fence-repository'
import { DesktopOwnerRepository } from './ports/desktop-owner-repository'
import { DesktopServiceBroker } from './ports/desktop-service-broker'
import { AppDatabaseLive, isAppDatabaseClientIsolated } from './services/database-service'
import { SettingsService } from './services/settings-service'
import { getSessionHostEventRuntime } from './session-host/session-host-events'

const DesktopJournalLive = Layer.mergeAll(
  SqliteDesktopFenceRepositoryLive,
  SqliteDesktopOwnerRepositoryLive,
).pipe(Layer.provide(AppDatabaseLive))

const DesktopServiceBrokerLive = Layer.scoped(
  DesktopServiceBroker,
  Effect.gen(function* () {
    const broker = makeDesktopServiceBroker({
      getHostInstanceId: () => getSessionHostEventRuntime().eventHub.hostInstanceId,
      fences: yield* DesktopFenceRepository,
      owners: yield* DesktopOwnerRepository,
      offlineExecute: makeOfflineDesktopCleanupExecutor(terminalHistoryDirectory()),
    })
    yield* Effect.addFinalizer(() => Effect.sync(() => broker.close()))
    return broker
  }),
).pipe(Layer.provide(DesktopJournalLive))

const DesktopNativeOrProxyLive = Layer.unwrapEffect(
  Effect.sync(() =>
    isAppDatabaseClientIsolated()
      ? Layer.mergeAll(
          NodePtyTerminalServiceLive,
          ElectronBrowserPreviewAutomationServiceLive.pipe(Layer.provide(SettingsService.Live)),
        )
      : Layer.mergeAll(RemoteTerminalServiceLive, RemoteBrowserPreviewAutomationServiceLive).pipe(
          Layer.provide(DesktopServiceBrokerLive),
        ),
  ),
)

/** The detached Host only receives proxies; native PTYs/WebContents belong to the GUI. */
export const DesktopServicesLive = Layer.mergeAll(
  DesktopServiceBrokerLive,
  DesktopNativeOrProxyLive,
)
