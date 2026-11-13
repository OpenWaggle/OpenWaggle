import * as Effect from 'effect/Effect'
import { browserEngine } from '../desktop-shell/browser-engine'
import { requireBrowserEngine } from '../ports/desktop-shell/browser-engine'
import { broadcastToWindows } from '../utils/broadcast'
import { typedHandle } from './typed-ipc'

/** Fails with the engine's reason unless it is ready; every preview open runs it first. */
export const requireBrowserEngineEffect = Effect.tryPromise({
  try: () => requireBrowserEngine(browserEngine),
  catch: (error) => error,
})

/** The browser engine's install (a download on macOS) and its status for every window. */
export function registerBrowserEngineHandlers(): void {
  browserEngine.onStatus((status) => broadcastToWindows('browser-engine:status-changed', status))
  typedHandle('browser-engine:ensure', () => Effect.promise(() => browserEngine.ensure()))
  typedHandle('browser-engine:get-status', () => Effect.sync(() => browserEngine.status()))
}
