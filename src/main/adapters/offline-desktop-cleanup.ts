import path from 'node:path'
import type { DesktopServiceCommand, DesktopServiceResult } from '@shared/types/desktop-service'
import * as Effect from 'effect/Effect'
import { desktopUnavailableError } from '../application/desktop-service-errors'
import { makeTerminalHistoryStore } from './terminal/terminal-history-store'

/**
 * The broker must first prove a never-adopted or cleanly closed desktop owner and
 * hold its durable offline fence. No live resources may exist under that proof.
 * This adapter only removes cold history and answers presence inspections with
 * "nothing native exists"; it never constructs Electron or a PTY.
 */
export function makeOfflineDesktopCleanupExecutor(logsDir: string) {
  if (!path.isAbsolute(logsDir)) throw new Error('Terminal history directory must be absolute.')
  const history = makeTerminalHistoryStore(logsDir)

  return (command: DesktopServiceCommand) => {
    if (command.service === 'browser' && command.operation === 'deleteOwner') {
      if (!command.ownerKey.trim()) {
        const effect: Effect.Effect<DesktopServiceResult, Error> = Effect.fail(
          new Error('A Session owner is required.'),
        )
        return effect
      }
      const effect: Effect.Effect<DesktopServiceResult, Error> = Effect.succeed({
        service: 'browser',
        operation: 'deleteOwner',
        value: null,
      })
      return effect
    }
    if (command.service === 'browser' && command.operation === 'inspectOwner') {
      const effect: Effect.Effect<DesktopServiceResult, Error> = Effect.succeed({
        service: 'browser',
        operation: 'inspectOwner',
        value: { registered: false, previews: 0 },
      })
      return effect
    }
    if (command.service === 'terminal' && command.operation === 'getActivitySnapshot') {
      const effect: Effect.Effect<DesktopServiceResult, Error> = Effect.succeed({
        service: 'terminal',
        operation: 'getActivitySnapshot',
        value: { revision: 0, summaries: [], truncated: false },
      })
      return effect
    }
    if (command.service === 'terminal' && command.operation === 'closeAllForOwner') {
      if (!command.input.ownerKey.trim()) {
        const effect: Effect.Effect<DesktopServiceResult, Error> = Effect.fail(
          new Error('A Session owner is required.'),
        )
        return effect
      }
      const effect: Effect.Effect<DesktopServiceResult, Error> = Effect.tryPromise({
        try: async () => {
          if (command.input.deleteHistory) await history.removeForOwner(command.input.ownerKey)
          return { service: 'terminal', operation: 'closeAllForOwner', value: null } as const
        },
        catch: cleanupError,
      })
      return effect
    }
    if (command.service === 'terminal' && command.operation === 'closeAllUnderPath') {
      if (!path.isAbsolute(command.input.directoryPath)) {
        const effect: Effect.Effect<DesktopServiceResult, Error> = Effect.fail(
          new Error('A worktree cleanup path must be absolute.'),
        )
        return effect
      }
      const effect: Effect.Effect<DesktopServiceResult, Error> = Effect.tryPromise({
        try: async () => {
          if (command.input.deleteHistory) await history.removeForPath(command.input.directoryPath)
          return { service: 'terminal', operation: 'closeAllUnderPath', value: null } as const
        },
        catch: cleanupError,
      })
      return effect
    }
    const effect: Effect.Effect<DesktopServiceResult, Error> =
      Effect.fail(desktopUnavailableError())
    return effect
  }
}

function cleanupError(error: unknown) {
  return error instanceof Error
    ? error
    : new Error('Offline desktop cleanup failed.', { cause: error })
}
