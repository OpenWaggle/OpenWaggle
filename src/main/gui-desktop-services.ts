import { Effect } from 'effect'
import { makeGuiDesktopCleanup } from './application/gui-desktop-cleanup'
import { browserPreviewManager } from './browser-preview'
import { browserPreviewOwnerRegistry } from './browser-preview-owner-registry'
import {
  DesktopNativeRecoveryUnavailableError,
  quarantineDesktopNativeAdmission,
} from './desktop-native-admission'
import { BrowserPreviewAutomationService } from './ports/browser-preview-automation-service'
import { TerminalService } from './ports/terminal-service'
import {
  DesktopNativeQuarantinedError,
  DesktopServiceAttachmentError,
  startGuiDesktopServiceBridge,
} from './session-host/gui-desktop-service-bridge'
import { makeGuiDesktopServiceExecutor } from './session-host/gui-desktop-service-executor'
import {
  DESKTOP_SHUTDOWN_DRAIN_MS,
  type GuiDesktopServiceLifecycle,
  withDesktopShutdownDeadline,
} from './session-host/gui-desktop-service-lifecycle'
import type { GuiSessionHostLifecycle } from './session-host/gui-session-host-lifecycle'

const RECOVERY_RECONNECTING_MESSAGE =
  'Desktop tools were recovered but are still reconnecting to the Session Host. Try again in a moment.'
const RECOVERY_QUITTING_MESSAGE = 'OpenWaggle is quitting. Try again if it stays open.'
const RECOVERY_SHUT_DOWN_MESSAGE =
  'Desktop tools were shut down for quit. Quit OpenWaggle again, or reopen it.'
const RECOVERY_BLOCKING_QUIT_MESSAGE =
  'A desktop tools recovery was still in progress. Try quitting again.'
const RECOVERY_STOPPED_MESSAGE =
  'Desktop tools could not reattach to the Session Host. Quit and reopen OpenWaggle.'

/** Start before renderer IPC is registered, so native ownership precedes every user admission. */
export async function startAppGuiDesktopServices(input: {
  readonly client: GuiSessionHostLifecycle['client']
  readonly runEffect: <A, E>(
    effect: Effect.Effect<A, E, TerminalService | BrowserPreviewAutomationService>,
  ) => Promise<A>
  readonly disposeRuntime: () => Promise<void>
}) {
  const services = await input.runEffect(
    Effect.gen(function* () {
      return { terminal: yield* TerminalService, browser: yield* BrowserPreviewAutomationService }
    }),
  )
  const executor = makeGuiDesktopServiceExecutor({
    ...services,
    deleteBrowserOwner: (ownerKey) => browserPreviewManager.closeForOwner(ownerKey),
    inspectBrowserOwner: (ownerKey) => ({
      registered: browserPreviewOwnerRegistry.isRegistered(ownerKey),
      previews: browserPreviewManager.listOwnedPreviews(ownerKey).length,
    }),
    acquireBrowserMutationFence: (scope) => browserPreviewManager.acquireMutationFence(scope),
  })
  let bridge: GuiDesktopServiceLifecycle | undefined
  let shuttingDown = false
  let desktopToolsShutDown = false
  let recovering: Promise<void> | undefined
  const cleanup = makeGuiDesktopCleanup({
    stopBridge: async () => {
      // A recovery in flight may still install the bridge this quit must stop and close.
      shuttingDown = true
      try {
        if (recovering) {
          await withDesktopShutdownDeadline(
            recovering.catch(() => undefined),
            Date.now() + DESKTOP_SHUTDOWN_DRAIN_MS,
          ).catch(() => {
            throw new Error(RECOVERY_BLOCKING_QUIT_MESSAGE)
          })
        }
        await bridge?.stop()
      } catch (error) {
        // The quit is retryable and the window stays open, so recovery must remain available.
        shuttingDown = false
        throw error
      }
      // Native shutdown begins next; this window can no longer host desktop tools.
      desktopToolsShutDown = true
    },
    beginBrowserShutdown: () => browserPreviewManager.beginShutdown(),
    closeTerminals: () => Effect.runPromise(services.terminal.closeAll()),
    disposeRuntime: input.disposeRuntime,
    closeBrowsers: () => browserPreviewManager.closeAll(),
    // A quarantined process owns no cleanup receipt for the previous desktop.
    markClosed: () => bridge?.markClosed() ?? Promise.resolve(),
  })

  async function recoverPreviousOwner() {
    if (desktopToolsShutDown)
      throw new DesktopNativeRecoveryUnavailableError(RECOVERY_SHUT_DOWN_MESSAGE)
    // Retryable: a quit that fails leaves the window open, and every attempt re-checks this.
    if (shuttingDown) throw new Error(RECOVERY_QUITTING_MESSAGE)
    if (bridge !== undefined) {
      // An earlier recovery was accepted; its lifecycle keeps reattaching in the background.
      const attachment = bridge.attachment()
      if (attachment === 'attached') return
      if (attachment === 'stopped')
        throw new DesktopNativeRecoveryUnavailableError(RECOVERY_STOPPED_MESSAGE)
      throw new Error(RECOVERY_RECONNECTING_MESSAGE)
    }
    try {
      bridge = await startGuiDesktopServiceBridge({
        client: input.client,
        executor,
        recoverPreviousOwner: true,
      })
    } catch (error) {
      if (!(error instanceof DesktopServiceAttachmentError)) throw error
      // The Host accepted the attestation; keep the reconnecting lifecycle for quit cleanup.
      bridge = error.lifecycle
      throw new Error(shuttingDown ? RECOVERY_QUITTING_MESSAGE : RECOVERY_RECONNECTING_MESSAGE, {
        cause: error,
      })
    }
    // Quit began meanwhile; it stops this bridge, so do not report desktop tools as usable.
    if (shuttingDown) throw new Error(RECOVERY_QUITTING_MESSAGE)
  }

  try {
    bridge = await startGuiDesktopServiceBridge({ client: input.client, executor })
  } catch (error) {
    if (error instanceof DesktopServiceAttachmentError) {
      bridge = error.lifecycle
      await cleanup()
      throw error
    }
    if (!(error instanceof DesktopNativeQuarantinedError)) throw error
    quarantineDesktopNativeAdmission({
      recover: () => {
        recovering = recoverPreviousOwner()
        return recovering
      },
    })
  }
  return cleanup
}
