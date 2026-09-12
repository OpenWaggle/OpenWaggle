import type { TerminalAttachResult, TerminalKey, TerminalOpenInput } from '@shared/types/terminal'
import { terminalKeyOf } from '@shared/types/terminal'
import { normalizeTerminalEnvironment } from '@shared/utils/terminal-environment'
import * as Effect from 'effect/Effect'
import { createLogger } from '../../logger'
import { assertTerminalRecordCapacity } from './terminal-capacity'
import { ownerKeyFromTerminalKey } from './terminal-history-files'
import { createTerminalHistorySanitizer } from './terminal-history-sanitizer'
import {
  activateInputGenerationForLaunch,
  adoptPreOpenInput,
  discardEmptyPendingLaunchState,
} from './terminal-launch-input-state'
import {
  enqueueTerminalOperation,
  terminalOperationBlockDisposition,
  waitForTerminalScopeOperation,
} from './terminal-operation-queue'
import type { TerminalRecord } from './terminal-records'
import type { TerminalRuntime } from './terminal-runtime'
import {
  CLOSED_SNAPSHOT,
  clampReplay,
  resetPersistedHistory,
  resolveTerminalKey,
  runningSnapshot,
  type TerminalActionContext,
} from './terminal-service-actions'
import { validateTerminalCwd } from './terminal-shell'

const logger = createLogger('terminal-lifecycle')

function clearTerminalBackendBuffer(record: { readonly live: { readonly pty: unknown } | null }) {
  const pty = record.live?.pty
  if (pty === null || pty === undefined) return
  const clear: unknown = Reflect.get(pty, 'clear')
  if (typeof clear !== 'function') return
  try {
    Reflect.apply(clear, pty, [])
  } catch (error) {
    // The durable and renderer clears remain valid if an older node-pty or a
    // degraded ConPTY backend cannot synchronize its private screen buffer.
    logger.warn('Terminal backend buffer clear failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export function clearTerminalAction(
  context: TerminalActionContext,
  ownerKey: string,
  terminalId: string,
): Effect.Effect<void> {
  return Effect.promise(async () => {
    const key = resolveTerminalKey(context, terminalKeyOf(ownerKey, terminalId))
    const record = context.runtime.records.get(key)
    if (record === undefined) return
    const blockDisposition = terminalOperationBlockDisposition(context.operationQueue, {
      key,
      ownerKey: record.ownerKey,
      cwd: record.cwd,
    })
    if (blockDisposition === 'retry') {
      await waitForTerminalScopeOperation(context.operationQueue)
      await Effect.runPromise(clearTerminalAction(context, ownerKey, terminalId))
      return
    }
    if (blockDisposition === 'cancel') {
      return
    }
    await enqueueTerminalOperation(
      context.operationQueue,
      key,
      async () => {
        const current = context.runtime.records.get(resolveTerminalKey(context, key))
        if (current === undefined) return
        const live = current.live
        const pausedByClear = live !== null && !live.outputPaused
        if (pausedByClear) {
          live.pauseOutput()
          live.outputPaused = true
        }
        try {
          await resetPersistedHistory(context.runtime, current.key)
          clearTerminalBackendBuffer(current)
          current.scrollback.reset()
          current.sanitizer = createTerminalHistorySanitizer()
          context.runtime.resetOutputStream(current)
          context.runtime.emitEvent(current, {
            type: 'cleared',
            outputGeneration: current.outputGeneration,
          })
        } catch (error) {
          if (pausedByClear && current.live === live && live.outputPaused) {
            live.resumeOutput()
            live.outputPaused = false
          }
          throw error
        }
      },
      record.cwd,
    )
  })
}

export function restartTerminalAction(
  context: TerminalActionContext,
  input: TerminalOpenInput,
): Effect.Effect<TerminalAttachResult> {
  return Effect.suspend(() => {
    const requestedKey = terminalKeyOf(input.ownerKey, input.terminalId)
    const key = resolveTerminalKey(context, requestedKey)
    const existing = context.runtime.records.get(key)
    const normalizedInput =
      key === requestedKey
        ? input
        : { ...input, ownerKey: existing?.ownerKey ?? ownerKeyFromTerminalKey(key) }
    const blockDisposition = terminalOperationBlockDisposition(context.operationQueue, {
      key,
      ownerKey: normalizedInput.ownerKey,
      cwd: normalizedInput.cwd,
    })
    if (context.isClosing() || blockDisposition === 'cancel') {
      return Effect.succeed(CLOSED_SNAPSHOT)
    }
    if (blockDisposition === 'retry') {
      return Effect.promise(async () => {
        await waitForTerminalScopeOperation(context.operationQueue)
        return Effect.runPromise(restartTerminalAction(context, input))
      })
    }
    assertTerminalRecordCapacity(context, key, normalizedInput.ownerKey)
    activateInputGenerationForLaunch(context, key, input.inputGeneration)
    const started = enqueueTerminalOperation(
      context.operationQueue,
      key,
      () => restartOnce(context, normalizedInput),
      normalizedInput.cwd,
    )
    // Restart replaces the launch context just like a context-changing open.
    // Register it before the queued operation begins so same-turn input waits
    // for the new shell instead of reaching the old PTY.
    context.inFlightOpens.set(key, started)
    void started
      .finally(() => {
        if (context.inFlightOpens.get(key) === started) {
          context.inFlightOpens.delete(key)
          discardEmptyPendingLaunchState(context, key)
        }
      })
      .catch(() => undefined)
    return Effect.promise(() => started)
  })
}

async function restartMissingCwd(
  runtime: TerminalRuntime,
  key: TerminalKey,
  existing: TerminalRecord | undefined,
): Promise<TerminalAttachResult> {
  if (existing !== undefined && !(await runtime.killLive(existing))) {
    throw new Error('Terminal process could not be stopped.')
  }
  if (existing !== undefined && !(await runtime.shutdownDetachedProcesses([existing]))) {
    throw new Error('Terminal output and native resources did not finish draining.')
  }
  return {
    history: clampReplay(await runtime.history.read(key)),
    outputBytes: 0,
    outputGeneration: 0,
    readiness: null,
    pendingInputBytes: 0,
    running: false,
    cwdMissing: true,
    processName: existing?.activity?.processName ?? null,
    ports: existing?.activity?.ports ?? [],
    projectActionPending: existing?.projectAction !== null && existing?.projectAction !== undefined,
  }
}

async function restartOnce(context: TerminalActionContext, input: TerminalOpenInput) {
  const { runtime } = context
  const key = terminalKeyOf(input.ownerKey, input.terminalId)
  const existing = runtime.records.get(key)
  const cwd = validateTerminalCwd(input.cwd)
  if (cwd === null) return restartMissingCwd(runtime, key, existing)
  const record = existing ?? runtime.makeRecord(input, cwd)
  if (!(await runtime.killLive(record))) throw new Error('Terminal process could not be stopped.')
  if (!(await runtime.shutdownDetachedProcesses([record]))) {
    throw new Error('Terminal output and native resources did not finish draining.')
  }
  runtime.prepareProjectActionForRestart(record)
  // Input already acknowledged as queued remains user-owned across restart.
  // Preserve whatever did not drain before the old PTY stopped, then let the
  // new readiness gate release it in the same order.
  await resetPersistedHistory(runtime, key)
  if (existing === undefined) {
    runtime.records.set(key, record)
    adoptPreOpenInput(context, record)
  }
  record.closed = false
  record.cwd = cwd
  await runtime.history.registerWorkingDirectory(record.key, cwd)
  if (input.env !== undefined) record.env = normalizeTerminalEnvironment(input.env)
  record.scrollback.reset()
  record.sanitizer = createTerminalHistorySanitizer()
  record.outputBytes = 0
  runtime.discardPendingOutput(key)
  runtime.spawn(record, input.cols, input.rows)
  return runningSnapshot(record, '')
}
