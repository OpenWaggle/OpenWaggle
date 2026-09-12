import { Effect } from 'effect'
import { makeGuiDesktopCleanup } from './application/gui-desktop-cleanup'
import { browserPreviewManager } from './browser-preview'
import { quarantineDesktopNativeAdmission } from './desktop-native-admission'
import { BrowserPreviewAutomationService } from './ports/browser-preview-automation-service'
import { TerminalService } from './ports/terminal-service'
import {
  DesktopNativeQuarantinedError,
  DesktopServiceAttachmentError,
  startGuiDesktopServiceBridge,
} from './session-host/gui-desktop-service-bridge'
import { makeGuiDesktopServiceExecutor } from './session-host/gui-desktop-service-executor'
import type { GuiSessionHostLifecycle } from './session-host/gui-session-host-lifecycle'

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
    acquireBrowserMutationFence: (scope) => browserPreviewManager.acquireMutationFence(scope),
  })
  let bridge: Awaited<ReturnType<typeof startGuiDesktopServiceBridge>> | undefined
  const cleanup = makeGuiDesktopCleanup({
    stopBridge: () => bridge?.stop() ?? Promise.resolve(),
    beginBrowserShutdown: () => browserPreviewManager.beginShutdown(),
    closeTerminals: () => Effect.runPromise(services.terminal.closeAll()),
    disposeRuntime: input.disposeRuntime,
    closeBrowsers: () => browserPreviewManager.closeAll(),
    // A quarantined process owns no cleanup receipt for the previous desktop.
    markClosed: () => bridge?.markClosed() ?? Promise.resolve(),
  })
  try {
    bridge = await startGuiDesktopServiceBridge({ client: input.client, executor })
  } catch (error) {
    if (error instanceof DesktopServiceAttachmentError) {
      bridge = error.lifecycle
      await cleanup()
      throw error
    }
    if (!(error instanceof DesktopNativeQuarantinedError)) throw error
    quarantineDesktopNativeAdmission()
  }
  return cleanup
}
