export interface GuiDesktopCleanupServices {
  readonly stopBridge: () => Promise<void>
  readonly beginBrowserShutdown: () => void
  readonly closeTerminals: () => Promise<void>
  readonly disposeRuntime: () => Promise<void>
  readonly closeBrowsers: () => Promise<void>
  readonly markClosed: () => Promise<void>
}

/** A retry resumes after the last proven stage; a failed receipt never reruns disposed services. */
export function makeGuiDesktopCleanup(services: GuiDesktopCleanupServices) {
  let bridgeStopped = false
  let terminalsClosed = false
  let runtimeDisposed = false
  let browsersClosed = false
  let completed = false
  let pending: Promise<void> | null = null

  async function attempt() {
    if (!bridgeStopped) {
      await services.stopBridge()
      bridgeStopped = true
      services.beginBrowserShutdown()
    }
    if (!terminalsClosed) {
      await services.closeTerminals()
      terminalsClosed = true
    }
    if (!runtimeDisposed) {
      await services.disposeRuntime()
      runtimeDisposed = true
    }
    if (!browsersClosed) {
      await services.closeBrowsers()
      browsersClosed = true
    }
    await services.markClosed()
    completed = true
  }

  return () => {
    if (completed) return Promise.resolve()
    if (!pending)
      pending = attempt().finally(() => {
        pending = null
      })
    return pending
  }
}
