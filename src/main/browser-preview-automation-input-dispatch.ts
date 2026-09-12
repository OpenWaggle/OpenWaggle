import {
  BrowserPreviewAutomationDeadline,
  type BrowserPreviewAutomationRunOptions,
} from './browser-preview-automation-deadline'
import { ensureBrowserPreviewAutomationDebugger } from './browser-preview-automation-debugger'
import type { BrowserPreviewAutomationControlSession } from './browser-preview-automation-session'

const INPUT_CLEANUP_TIMEOUT_MS = 2_000

export async function sendBrowserPreviewAutomationInputCleanup(
  session: BrowserPreviewAutomationControlSession,
  method: string,
  params?: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  if (session.disposed) return null
  const options: BrowserPreviewAutomationRunOptions = { timeoutMs: INPUT_CLEANUP_TIMEOUT_MS }
  const deadline = new BrowserPreviewAutomationDeadline(options)
  try {
    await deadline.race(ensureBrowserPreviewAutomationDebugger(session))
    const result: unknown = await deadline.race(session.debugger.sendCommand(method, params))
    return result
  } finally {
    deadline.dispose()
  }
}

export async function withExpectedBrowserPreviewAutomationInput<A>(
  session: BrowserPreviewAutomationControlSession,
  method: string,
  params: Readonly<Record<string, unknown>> | undefined,
  operation: () => Promise<A>,
) {
  const expectation = session.inputArbitrator.expect(method, params)
  try {
    return await operation()
  } catch (error) {
    session.inputArbitrator.cancel(expectation)
    throw error
  }
}
