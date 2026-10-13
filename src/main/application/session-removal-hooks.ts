import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'

const logger = createLogger('session-removal-hooks')

type SessionRemovalHook = (sessionId: SessionId) => Promise<void>

const hooks = new Set<SessionRemovalHook>()

/**
 * Registers work that must happen when a Session is archived or deleted, including a Worker
 * archived by Hive cleanup, such as closing the Session's MCP server connections. Returns the
 * function that unregisters it.
 */
export function onSessionRemoved(hook: SessionRemovalHook) {
  hooks.add(hook)
  return () => {
    hooks.delete(hook)
  }
}

/** Runs every hook. A failing hook is logged and never blocks the removal. */
export function runSessionRemovalHooks(sessionId: SessionId) {
  return Effect.promise(() =>
    Promise.all(
      [...hooks].map((hook) =>
        hook(sessionId).catch((error: unknown) => {
          logger.warn('Session removal cleanup failed', {
            sessionId,
            error: error instanceof Error ? error.message : String(error),
          })
        }),
      ),
    ),
  )
}
