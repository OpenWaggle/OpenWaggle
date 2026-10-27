import * as Effect from 'effect/Effect'
import type { GuiStartupCoordinator } from '../gui-startup-coordinator'
import { typedHandle } from './typed-ipc'

/** The window's startup state and its Retry, answered before the backend is ready (A-F2). */
export function registerStartupHandlers(startup: GuiStartupCoordinator): void {
  typedHandle('app:get-startup-status', () => Effect.sync(() => startup.status()))
  typedHandle('app:retry-startup', () => Effect.sync(() => startup.retry()))
}
