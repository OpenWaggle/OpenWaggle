import type { BrowserPreviewAutomationControlSession } from './browser-preview-automation-session'

const CDP_VERSION = '1.3'

function assertDebuggerOwnership(session: BrowserPreviewAutomationControlSession) {
  if (session.contents.isDevToolsOpened()) {
    throw new Error('Close DevTools for this browser preview before running agent automation.')
  }
  if (session.debugger.isAttached() && !session.debuggerOwned) {
    throw new Error(
      'Browser preview automation is unavailable because another debugger is attached. Disconnect it and retry.',
    )
  }
}

export function ensureBrowserPreviewAutomationDebugger(
  session: BrowserPreviewAutomationControlSession,
) {
  assertDebuggerOwnership(session)
  session.debuggerReady ??= Promise.resolve()
    .then(async () => {
      assertDebuggerOwnership(session)
      if (!session.debugger.isAttached()) {
        try {
          session.debugger.attach(CDP_VERSION)
        } catch (cause) {
          assertDebuggerOwnership(session)
          throw new Error(
            'Browser preview automation could not attach to Chromium. Close DevTools or disconnect another debugger and retry.',
            { cause },
          )
        }
        session.debuggerOwned = true
      }
      await Promise.all(
        ['Runtime.enable', 'Accessibility.enable', 'Network.enable', 'Log.enable'].map((method) =>
          session.debugger.sendCommand(method),
        ),
      )
    })
    .catch((error: unknown) => {
      session.debuggerReady = null
      throw error
    })
  return session.debuggerReady
}
