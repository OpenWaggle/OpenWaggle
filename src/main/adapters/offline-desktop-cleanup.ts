import path from 'node:path'
import type { DesktopServiceCommand, DesktopServiceResult } from '@shared/types/desktop-service'
import * as Effect from 'effect/Effect'
import { desktopUnavailableError } from '../application/desktop-service-errors'
import { makeTerminalHistoryStore } from './terminal/terminal-history-store'

/**
 * The broker must first prove a never-adopted or cleanly closed desktop owner and
 * hold its durable offline fence. No live resources may exist under that proof.
 * This adapter only removes cold history; it never constructs Electron or a PTY.
 */
export function makeOfflineDesktopCleanupExecutor(logsDir: string) {
  if (!path.isAbsolute(logsDir)) throw new Error('Terminal history directory must be absolute.')
  const history = makeTerminalHistoryStore(logsDir)

  return (command: DesktopServiceCommand): Effect.Effect<DesktopServiceResult, Error> => {
    if (command.service === 'browser' && command.operation === 'deleteOwner') {
      if (!command.ownerKey.trim()) return Effect.fail(new Error('A Session owner is required.'))
      return Effect.succeed({ service: 'browser', operation: 'deleteOwner', value: null })
    }
    if (command.service === 'terminal' && command.operation === 'closeAllForOwner') {
      if (!command.input.ownerKey.trim())
        return Effect.fail(new Error('A Session owner is required.'))
      return Effect.tryPromise({
        try: async () => {
          if (command.input.deleteHistory) await history.removeForOwner(command.input.ownerKey)
          return { service: 'terminal', operation: 'closeAllForOwner', value: null } as const
        },
        catch: cleanupError,
      })
    }
    if (command.service === 'terminal' && command.operation === 'closeAllUnderPath') {
      if (!path.isAbsolute(command.input.directoryPath)) {
        return Effect.fail(new Error('A worktree cleanup path must be absolute.'))
      }
      return Effect.tryPromise({
        try: async () => {
          if (command.input.deleteHistory) await history.removeForPath(command.input.directoryPath)
          return { service: 'terminal', operation: 'closeAllUnderPath', value: null } as const
        },
        catch: cleanupError,
      })
    }
    return Effect.fail(desktopUnavailableError())
  }
}

function cleanupError(error: unknown) {
  return error instanceof Error
    ? error
    : new Error('Offline desktop cleanup failed.', { cause: error })
}
