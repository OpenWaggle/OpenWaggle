import type { StartupMark } from './startup-timing'

/**
 * Opens the desktop window before this process evaluates its IPC handlers and GUI runtime
 * modules (W11): the renderer process starts, and the window's first paint nears, while they
 * load (≈20 ms on a cold start). The renderer cannot invoke a handler before they are registered:
 * its scripts run 100+ ms after navigation starts, and the bundled modules load in microtasks,
 * which finish before this process handles the next IPC message. Keep `registerIpc` free of real
 * I/O for that reason.
 */
export async function openWindowThenRegisterIpc(steps: {
  /** The app's protocols, which the window's first request needs. */
  readonly registerProtocols: () => void
  readonly createWindow: () => void
  readonly registerIpc: () => Promise<void>
  readonly startupMark: StartupMark
}) {
  steps.registerProtocols()
  steps.startupMark('protocol-handlers-registered')
  steps.createWindow()
  steps.startupMark('main-window-created')
  await steps.registerIpc()
  steps.startupMark('ipc-handlers-registered')
}
