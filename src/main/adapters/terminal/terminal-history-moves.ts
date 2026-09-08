import type { TerminalKey, TerminalOwnerKey } from '@shared/types/terminal'
import { terminalKeyOf } from '@shared/types/terminal'
import { createLogger } from '../../logger'
import {
  type HistoryFiles,
  TERMINAL_HISTORY_LOG_EXTENSION,
  TERMINAL_HISTORY_METADATA_EXTENSION,
  TERMINAL_HISTORY_WORKING_DIRECTORY_EXTENSION,
  type TerminalHistoryFiles,
  terminalIdForOwner,
} from './terminal-history-files'
import type { TerminalHistoryCounts } from './terminal-history-retention'

const logger = createLogger('terminal-history')

interface HistoryMove {
  readonly fromKey: TerminalKey
  readonly toKey: TerminalKey
  readonly from: HistoryFiles
  readonly to: HistoryFiles
  readonly logExists: boolean
  readonly workingDirectoryExists: boolean
}

export interface TerminalHistoryMover {
  move(fromKey: TerminalKey, toKey: TerminalKey): Promise<void>
  moveOwner(fromOwnerKey: TerminalOwnerKey, toOwnerKey: TerminalOwnerKey): Promise<void>
}

const historyMoveConflict = () => new Error('Terminal history destination already exists')

class TerminalHistoryMoverImpl implements TerminalHistoryMover {
  constructor(
    private readonly files: TerminalHistoryFiles,
    private readonly states: Map<TerminalKey, TerminalHistoryCounts>,
    private readonly workingDirectories: Map<TerminalKey, string>,
  ) {}

  async move(fromKey: TerminalKey, toKey: TerminalKey) {
    await this.files.ensureDirectory()
    const move = await this.makeMove(fromKey, toKey)
    const moves = move === null ? [] : [move]
    await this.preflight(moves)
    await this.apply(moves)
  }

  async moveOwner(fromOwnerKey: TerminalOwnerKey, toOwnerKey: TerminalOwnerKey) {
    await this.files.ensureDirectory()
    const moves = await this.planOwnerMove(fromOwnerKey, toOwnerKey)
    await this.preflight(moves)
    await this.apply(moves)
  }

  private async makeMove(fromKey: TerminalKey, toKey: TerminalKey) {
    const from = this.files.describe(fromKey)
    const to = this.files.describe(toKey)
    const sourceMetadata = await this.files.readIfPresent(from.metadataFile)
    const logExists = await this.files.exists(from.logFile)
    const workingDirectoryExists = await this.files.exists(from.workingDirectoryFile)
    if (sourceMetadata === null && !logExists && !workingDirectoryExists) return null
    if (sourceMetadata !== fromKey) {
      throw new Error('Terminal history source metadata is missing')
    }
    return {
      fromKey,
      toKey,
      from,
      to,
      logExists,
      workingDirectoryExists,
    } satisfies HistoryMove
  }

  private async planOwnerMove(fromOwnerKey: TerminalOwnerKey, toOwnerKey: TerminalOwnerKey) {
    const entries = await this.files.listOwnerEntries(fromOwnerKey)
    const sourceLogs = new Set(
      entries.filter((entry) => entry.endsWith(TERMINAL_HISTORY_LOG_EXTENSION)),
    )
    const sourceWorkingDirectories = new Set(
      entries.filter((entry) => entry.endsWith(TERMINAL_HISTORY_WORKING_DIRECTORY_EXTENSION)),
    )
    const metadataEntries = entries.filter((entry) =>
      entry.endsWith(TERMINAL_HISTORY_METADATA_EXTENSION),
    )
    const moves: HistoryMove[] = []
    for (const metadataEntry of metadataEntries) {
      const fromKey = await this.files.read(this.files.pathForEntry(metadataEntry))
      const terminalId = terminalIdForOwner(fromKey, fromOwnerKey)
      if (terminalId === null) throw new Error('Terminal history owner metadata mismatch')
      const move = await this.makeMove(fromKey, terminalKeyOf(toOwnerKey, terminalId))
      if (move === null) continue
      moves.push(move)
      sourceLogs.delete(
        `${metadataEntry.slice(0, -TERMINAL_HISTORY_METADATA_EXTENSION.length)}${TERMINAL_HISTORY_LOG_EXTENSION}`,
      )
      sourceWorkingDirectories.delete(
        `${metadataEntry.slice(0, -TERMINAL_HISTORY_METADATA_EXTENSION.length)}${TERMINAL_HISTORY_WORKING_DIRECTORY_EXTENSION}`,
      )
    }
    if (sourceLogs.size > 0 || sourceWorkingDirectories.size > 0) {
      throw new Error('Terminal history source metadata is missing')
    }
    return moves
  }

  private async preflight(moves: readonly HistoryMove[]) {
    const destinations = new Set<string>()
    for (const move of moves) {
      if (destinations.has(move.to.baseName)) throw historyMoveConflict()
      destinations.add(move.to.baseName)
      if (
        (await this.files.exists(move.to.logFile)) ||
        (await this.files.exists(move.to.metadataFile)) ||
        (await this.files.exists(move.to.workingDirectoryFile))
      ) {
        throw historyMoveConflict()
      }
    }
  }

  private async apply(moves: readonly HistoryMove[]) {
    const moved: HistoryMove[] = []
    try {
      for (const move of moves) {
        await this.applyOne(move)
        moved.push(move)
      }
      for (const move of moved) {
        await this.files.writePrivate(move.to.metadataFile, move.toKey)
      }
    } catch (error) {
      await this.rollback(moved)
      throw error
    }

    for (const move of moved) this.moveCachedState(move)
  }

  private async applyOne(move: HistoryMove) {
    if (move.logExists) await this.files.rename(move.from.logFile, move.to.logFile)
    if (move.workingDirectoryExists) {
      try {
        await this.files.rename(move.from.workingDirectoryFile, move.to.workingDirectoryFile)
      } catch (error) {
        if (move.logExists) await this.files.rename(move.to.logFile, move.from.logFile)
        throw error
      }
    }
    try {
      await this.files.rename(move.from.metadataFile, move.to.metadataFile)
    } catch (error) {
      if (move.workingDirectoryExists) {
        await this.files.rename(move.to.workingDirectoryFile, move.from.workingDirectoryFile)
      }
      if (move.logExists) await this.files.rename(move.to.logFile, move.from.logFile)
      throw error
    }
  }

  private async rollback(moves: readonly HistoryMove[]) {
    for (let index = moves.length - 1; index >= 0; index -= 1) {
      const move = moves[index]
      if (move === undefined) continue
      try {
        await this.rollbackOne(move)
      } catch (error) {
        logger.error('Terminal history move rollback failed', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  private async rollbackOne(move: HistoryMove) {
    if (await this.files.exists(move.to.metadataFile)) {
      await this.files.writePrivate(move.to.metadataFile, move.fromKey)
      await this.files.rename(move.to.metadataFile, move.from.metadataFile)
    }
    if (move.workingDirectoryExists && (await this.files.exists(move.to.workingDirectoryFile))) {
      await this.files.rename(move.to.workingDirectoryFile, move.from.workingDirectoryFile)
    }
    if (move.logExists && (await this.files.exists(move.to.logFile))) {
      await this.files.rename(move.to.logFile, move.from.logFile)
    }
  }

  private moveCachedState(move: HistoryMove) {
    const state = this.states.get(move.fromKey)
    this.states.delete(move.fromKey)
    if (state !== undefined) this.states.set(move.toKey, state)
    const cwd = this.workingDirectories.get(move.fromKey)
    this.workingDirectories.delete(move.fromKey)
    if (cwd !== undefined) this.workingDirectories.set(move.toKey, cwd)
  }
}

export function makeTerminalHistoryMover(
  files: TerminalHistoryFiles,
  states: Map<TerminalKey, TerminalHistoryCounts>,
  workingDirectories: Map<TerminalKey, string>,
): TerminalHistoryMover {
  return new TerminalHistoryMoverImpl(files, states, workingDirectories)
}
