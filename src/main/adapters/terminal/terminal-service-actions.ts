import path from 'node:path'
import { TERMINAL } from '@shared/constants/resource-limits'
import type { TerminalAttachResult, TerminalKey, TerminalOpenInput } from '@shared/types/terminal'
import { terminalKeyOf } from '@shared/types/terminal'
import * as Effect from 'effect/Effect'
import { createLogger } from '../../logger'
import { decideTerminalOpen } from './terminal-open-semantics'
import type { TerminalRecord } from './terminal-records'
import type { TerminalRuntime } from './terminal-runtime'
import { validateTerminalCwd } from './terminal-shell'

const logger = createLogger('terminal-service-actions')

const CLOSED_SNAPSHOT: TerminalAttachResult = {
  history: '',
  outputBytes: 0,
  running: false,
  cwdMissing: true,
}

export interface TerminalActionContext {
  readonly runtime: TerminalRuntime
  readonly isClosing: () => boolean
  /** In-flight opens per terminal key, so concurrent opens coalesce. */
  readonly inFlightOpens: Map<TerminalKey, Promise<TerminalAttachResult>>
}

/**
 * Concurrent opens for one terminal coalesce onto the first in-flight open:
 * React StrictMode double-mounts and multi-window attaches would otherwise
 * create duplicate records racing over the same key.
 */
export function openTerminalAction(context: TerminalActionContext, input: TerminalOpenInput) {
  // Effect.suspend defers the in-flight check to run time, so re-running a
  // captured open effect coalesces exactly like a fresh invoke.
  return Effect.suspend(() => {
    const key = terminalKeyOf(input.ownerKey, input.terminalId)
    const inFlight = context.inFlightOpens.get(key)
    if (inFlight !== undefined) {
      return Effect.promise(() => inFlight)
    }

    const started = Effect.runPromise(openOnce(context, input))
    context.inFlightOpens.set(key, started)
    void started
      .finally(() => {
        context.inFlightOpens.delete(key)
      })
      .catch(() => undefined)
    return Effect.promise(() => started)
  })
}

const openOnce = (context: TerminalActionContext, input: TerminalOpenInput) =>
  Effect.promise(async () => {
    if (context.isClosing()) return CLOSED_SNAPSHOT
    const { runtime } = context
    const key = terminalKeyOf(input.ownerKey, input.terminalId)
    const record = runtime.records.get(key)
    const cwdExists = validateTerminalCwd(input.cwd) !== null
    const persistedForNew = cwdExists && record === undefined ? await runtime.history.read(key) : ''
    const decision = decideTerminalOpen(record, input, cwdExists, persistedForNew)
    return applyOpenDecision(context, input, record, decision)
  })

function clampReplay(history: string) {
  if (history.length <= TERMINAL.MAX_SCROLLBACK_BYTES) return history
  // Keep the newest bytes on a line boundary so replay never ships more than
  // the byte cap even when an old file predates it.
  const tail = history.slice(-TERMINAL.MAX_SCROLLBACK_BYTES)
  const firstNewline = tail.indexOf('\n')
  return firstNewline === -1 ? '' : tail.slice(firstNewline + 1)
}

function applyOpenDecision(
  context: TerminalActionContext,
  input: TerminalOpenInput,
  record: TerminalRecord | undefined,
  decision: ReturnType<typeof decideTerminalOpen>,
): TerminalAttachResult {
  const { runtime } = context
  if (decision.kind === 'cwd-missing') {
    return {
      history: clampReplay(decision.persisted),
      outputBytes: 0,
      running: false,
      cwdMissing: true,
    }
  }
  if (decision.kind === 'reuse' && record !== undefined && record.live !== null) {
    try {
      record.live.pty.resize(input.cols, input.rows)
    } catch (error) {
      logger.debug('Terminal resize on re-open ignored', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
    return {
      history: clampReplay(record.scrollback.toString()),
      outputBytes: record.outputBytes,
      running: true,
    }
  }
  if (decision.kind === 'create') {
    const cwd = validateTerminalCwd(input.cwd) ?? input.cwd
    const created = runtime.makeRecord(input, cwd)
    runtime.records.set(created.key, created)
    const persisted = clampReplay(decision.persisted)
    created.scrollback.append(persisted)
    runtime.spawn(created, input.cols, input.rows)
    // The replayed file predates the fresh shell's stream, which starts at 0.
    return { history: persisted, outputBytes: 0, running: true }
  }
  if (record === undefined) return CLOSED_SNAPSHOT
  if (decision.kind === 'context-change' || record.cwd !== input.cwd) {
    runtime.killLive(record)
    record.closed = false
    record.cwd = validateTerminalCwd(input.cwd) ?? record.cwd
    record.scrollback.reset()
    record.pendingOutput = ''
    record.pendingStartOffset = 0
    record.outputBytes = 0
    runtime.discardPendingOutput(record.key)
    runtime.history.truncate(record.key)
    runtime.spawn(record, input.cols, input.rows)
    return { history: '', outputBytes: 0, running: true }
  }
  runtime.spawn(record, input.cols, input.rows)
  return {
    history: clampReplay(record.scrollback.toString()),
    outputBytes: record.outputBytes,
    running: true,
  }
}

export function writeTerminalAction(
  context: TerminalActionContext,
  ownerKey: string,
  terminalId: string,
  data: string,
) {
  return Effect.sync(() => {
    context.runtime.records.get(terminalKeyOf(ownerKey, terminalId))?.live?.pty.write(data)
  })
}

export function resizeTerminalAction(
  context: TerminalActionContext,
  ownerKey: string,
  terminalId: string,
  cols: number,
  rows: number,
) {
  return Effect.sync(() => {
    try {
      context.runtime.records.get(terminalKeyOf(ownerKey, terminalId))?.live?.pty.resize(cols, rows)
    } catch (error) {
      logger.debug('Terminal resize ignored', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })
}

export function clearTerminalAction(
  context: TerminalActionContext,
  ownerKey: string,
  terminalId: string,
) {
  return Effect.try(() => {
    const key = terminalKeyOf(ownerKey, terminalId)
    const record = context.runtime.records.get(key)
    if (record === undefined) return
    // The scrollback/history reset is the clear: replaying an empty snapshot
    // plus the `cleared` event (which resets the live pane) erases everything
    // the renderer has. Writing escape codes into the shell's stdin cannot
    // clear the PTY's output side and would only pollute the new state.
    record.scrollback.reset()
    record.pendingOutput = ''
    record.pendingStartOffset = 0
    record.outputBytes = 0
    context.runtime.discardPendingOutput(key)
    context.runtime.history.truncate(key)
    context.runtime.emitEvent(record, { type: 'cleared' })
  })
}

export function restartTerminalAction(context: TerminalActionContext, input: TerminalOpenInput) {
  return Effect.promise(async () => {
    if (context.isClosing()) return CLOSED_SNAPSHOT
    const { runtime } = context
    const key = terminalKeyOf(input.ownerKey, input.terminalId)
    const cwd = validateTerminalCwd(input.cwd)
    if (cwd === null) {
      return {
        history: clampReplay(await runtime.history.read(key)),
        outputBytes: 0,
        running: false,
        cwdMissing: true,
      }
    }
    const existing = runtime.records.get(key)
    const record = existing ?? runtime.makeRecord(input, cwd)
    if (existing === undefined) runtime.records.set(key, record)
    runtime.killLive(record)
    record.closed = false
    record.cwd = cwd
    record.scrollback.reset()
    record.pendingOutput = ''
    record.pendingStartOffset = 0
    record.outputBytes = 0
    runtime.discardPendingOutput(key)
    runtime.history.truncate(key)
    runtime.spawn(record, input.cols, input.rows)
    return { history: '', outputBytes: 0, running: true } satisfies TerminalAttachResult
  })
}

export function closeTerminalAction(
  context: TerminalActionContext,
  ownerKey: string,
  terminalId: string,
  deleteHistory: boolean,
) {
  return Effect.sync(() => {
    const record = context.runtime.records.get(terminalKeyOf(ownerKey, terminalId))
    if (record === undefined) return
    closeRecord(context, record, deleteHistory)
  })
}

export function closeOwnerTerminalsAction(
  context: TerminalActionContext,
  ownerKey: string,
  deleteHistory: boolean,
) {
  return Effect.sync(() => {
    const { runtime } = context
    for (const record of [...runtime.records.values()]) {
      if (record.ownerKey !== ownerKey) continue
      closeRecord(context, record, deleteHistory)
    }
    if (deleteHistory) runtime.history.removeForOwner(ownerKey)
  })
}

export function closeTerminalsUnderPathAction(
  context: TerminalActionContext,
  directoryPath: string,
  deleteHistory: boolean,
) {
  return Effect.sync(() => {
    const { runtime } = context
    const prefix = directoryPath.endsWith(path.sep) ? directoryPath : directoryPath + path.sep
    for (const record of [...runtime.records.values()]) {
      if (!record.cwd.startsWith(prefix) && record.cwd !== directoryPath) continue
      closeRecord(context, record, deleteHistory)
    }
  })
}

export function closeAllTerminalsAction(context: TerminalActionContext) {
  return Effect.promise(async () => {
    const { runtime } = context
    runtime.flushOutputs()
    for (const record of runtime.records.values()) {
      runtime.killLive(record)
      record.closed = true
    }
    runtime.records.clear()
    await runtime.history.flush()
  })
}

function closeRecord(
  context: TerminalActionContext,
  record: TerminalRecord,
  deleteHistory: boolean,
) {
  const { runtime } = context
  runtime.killLive(record)
  // Mark closed before killing so a late onData cannot resurrect the history.
  record.closed = true
  runtime.records.delete(record.key)
  runtime.discardPendingOutput(record.key)
  if (deleteHistory) runtime.history.remove(record.key)
  runtime.emitEvent(record, { type: 'closed' })
}
