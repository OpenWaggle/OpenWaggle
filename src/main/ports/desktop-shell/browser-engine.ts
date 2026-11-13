import type { BrowserEngineStatus } from '@shared/types/browser-engine'
import { Context } from 'effect'

/**
 * The engine that renders Browser previews (ADR 0064). On macOS it is a downloadable CEF component
 * installed once per pinned CEF version; elsewhere, and in builds that bundle it, it is always
 * ready. A preview view must never be created before `ensure()` returned `ready`: on macOS a CEF
 * view without the engine silently becomes a system webview without the DevTools endpoint.
 */
export interface BrowserEngineShape {
  readonly status: () => BrowserEngineStatus
  /**
   * Makes the engine ready: a no-op when it is, otherwise the one install in flight. Resolves to
   * `ready` or `failed`; calling it again after a failure retries.
   */
  readonly ensure: () => Promise<BrowserEngineStatus>
  /** Calls `listener` with every status change; returns the unsubscribe. */
  readonly onStatus: (listener: (status: BrowserEngineStatus) => void) => () => void
}

export class BrowserEngine extends Context.Tag('@openwaggle/BrowserEngine')<
  BrowserEngine,
  BrowserEngineShape
>() {}

/** The message a preview open fails with while the engine is not ready. */
function unavailable(status: BrowserEngineStatus) {
  return new Error(
    status.type === 'failed'
      ? `The browser engine is not available: ${status.message}`
      : 'The browser engine is still being installed.',
  )
}

/** Ensures the engine, or throws a message a user or the agent can act on. */
export async function requireBrowserEngine(engine: Pick<BrowserEngineShape, 'ensure'>) {
  const status = await engine.ensure()
  if (status.type !== 'ready') throw unavailable(status)
}

/** Throws unless the engine is ready now; the last guard before a preview view is created. */
export function assertBrowserEngineReady(engine: Pick<BrowserEngineShape, 'status'>) {
  const status = engine.status()
  if (status.type !== 'ready') throw unavailable(status)
}
