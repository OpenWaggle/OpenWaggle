import { TERMINAL } from '@shared/constants/resource-limits'
import type { TerminalAttachResult, TerminalKey, TerminalOpenInput } from '@shared/types/terminal'
import { terminalKeyOf } from '@shared/types/terminal'
import { normalizeTerminalEnvironment } from '@shared/utils/terminal-environment'
import * as Effect from 'effect/Effect'
import { createLogger } from '../../logger'
import { assertTerminalRecordCapacity } from './terminal-capacity'
import { ownerKeyFromTerminalKey } from './terminal-history-files'
import { retainTerminalHistorySuffix } from './terminal-history-retention'
import { createTerminalHistorySanitizer } from './terminal-history-sanitizer'
import type { PendingTerminalInput } from './terminal-input-idempotency'
import { resolveTerminalAlias } from './terminal-key-aliases'
import {
  activateInputGenerationForLaunch,
  adoptPreOpenInput,
  discardEmptyPendingLaunchState,
} from './terminal-launch-input-state'
import { decideTerminalOpen } from './terminal-open-semantics'
import {
  enqueueTerminalOperation,
  type TerminalOperationQueue,
  terminalOperationBlockDisposition,
  waitForTerminalScopeOperation,
} from './terminal-operation-queue'
import type { TerminalRecord } from './terminal-records'
import { coldTerminalReplay } from './terminal-replay'
import type { TerminalRuntime } from './terminal-runtime'
import { validateTerminalCwd } from './terminal-shell'

const logger = createLogger('terminal-service-actions')

export { PREVIOUS_TERMINAL_SESSION_SEPARATOR } from './terminal-replay'

export const CLOSED_SNAPSHOT: TerminalAttachResult = {
  history: '',
  outputBytes: 0,
  outputGeneration: 0,
  readiness: null,
  pendingInputBytes: 0,
  running: false,
  cwdMissing: true,
  processName: null,
  ports: [],
  projectActionPending: false,
}

export interface TerminalActionContext {
  readonly runtime: TerminalRuntime
  readonly isClosing: () => boolean
  readonly inFlightOpens: Map<TerminalKey, Promise<TerminalAttachResult>>
  readonly operationQueue: TerminalOperationQueue
  readonly pendingInputByKey: Map<TerminalKey, PendingTerminalInput>
  readonly terminalKeyAliases: Map<TerminalKey, TerminalKey>
  readonly moveAttachments: (fromKey: TerminalKey, toKey: TerminalKey) => Promise<void>
  readonly onRecordsRekeyed: () => void
}

export function resolveTerminalKey(context: TerminalActionContext, key: TerminalKey): TerminalKey {
  return resolveTerminalAlias(context.terminalKeyAliases, key)
}

function snapshotReadiness(record: TerminalRecord) {
  return {
    phase: record.readinessPhase,
    generation: record.readinessGeneration,
  } as const
}

export function runningSnapshot(record: TerminalRecord, history: string): TerminalAttachResult {
  const portPreviews = record.activity?.portPreviews ?? []
  return {
    history: clampReplay(history),
    outputBytes: record.outputBytes,
    outputGeneration: record.outputGeneration,
    readiness: snapshotReadiness(record),
    pendingInputBytes: record.pendingInputBytes,
    running: true,
    processName: record.activity?.processName ?? null,
    ports: record.activity?.ports ?? [],
    ...(portPreviews.length === 0 ? {} : { portPreviews }),
    projectActionPending: record.projectAction !== null,
  }
}

function liveReplay(record: TerminalRecord) {
  return record.scrollback.toString() + record.sanitizer.pendingRawTail()
}

export function openTerminalAction(
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
    const blockDispositions = [
      terminalOperationBlockDisposition(context.operationQueue, {
        key: requestedKey,
        ownerKey: input.ownerKey,
        cwd: input.cwd,
      }),
      terminalOperationBlockDisposition(context.operationQueue, {
        key,
        ownerKey: normalizedInput.ownerKey,
        cwd: normalizedInput.cwd,
      }),
    ]
    if (context.isClosing() || blockDispositions.includes('cancel')) {
      return Effect.succeed(CLOSED_SNAPSHOT)
    }
    if (blockDispositions.includes('retry')) {
      return Effect.promise(async () => {
        await waitForTerminalScopeOperation(context.operationQueue)
        return Effect.runPromise(openTerminalAction(context, input))
      })
    }
    assertTerminalRecordCapacity(context, key, normalizedInput.ownerKey)
    // Register the newest renderer stream before the queued open operation
    // begins. A write sent immediately after invoke(open) can then stage behind
    // an existing record or an earlier pre-open batch with sequence zero.
    activateInputGenerationForLaunch(context, key, input.inputGeneration)
    // Every lifecycle mutation for a terminal shares this queue. A later open
    // keeps its own cwd, env, geometry, and renderer nonce while same-context
    // overlaps still reuse the one record whose spawn is already in progress.
    const started = enqueueTerminalOperation(
      context.operationQueue,
      key,
      () => Effect.runPromise(openOnce(context, normalizedInput)),
      normalizedInput.cwd,
    )
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

const openOnce = (context: TerminalActionContext, input: TerminalOpenInput) =>
  Effect.promise(async () => {
    if (context.isClosing()) return CLOSED_SNAPSHOT
    const { runtime } = context
    const key = terminalKeyOf(input.ownerKey, input.terminalId)
    const record = runtime.records.get(key)
    const cwd = validateTerminalCwd(input.cwd)
    const cwdExists = cwd !== null
    const persistedForNew = record === undefined ? await runtime.history.read(key) : ''
    const decision = decideTerminalOpen(record, input, cwdExists, persistedForNew)
    if (record === undefined && cwd !== null) {
      await runtime.history.registerWorkingDirectory(key, cwd)
    }
    const snapshot = await applyOpenDecision(context, input, record, decision)
    const current = runtime.records.get(key)
    if (current !== undefined && snapshot.running) {
      runtime.reconcileOutputSnapshot(current, snapshot.outputGeneration, snapshot.outputBytes)
    }
    return snapshot
  })

export function clampReplay(history: string) {
  return retainTerminalHistorySuffix(
    history,
    TERMINAL.MAX_SCROLLBACK_LINES,
    TERMINAL.MAX_SCROLLBACK_BYTES,
  ).text
}

export async function resetPersistedHistory(runtime: TerminalRuntime, key: TerminalKey) {
  await Promise.resolve(runtime.history.truncate(key))
  await runtime.history.flush()
}

function reuseLiveTerminal(
  record: TerminalRecord | undefined,
  input: TerminalOpenInput,
): TerminalAttachResult {
  if (record === undefined || record.live === null) return CLOSED_SNAPSHOT
  try {
    record.live.pty.resize(input.cols, input.rows)
  } catch (error) {
    logger.debug('Terminal resize on re-open ignored', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return runningSnapshot(record, liveReplay(record))
}

function reuseSpawningTerminal(record: TerminalRecord | undefined): TerminalAttachResult {
  if (record === undefined) return CLOSED_SNAPSHOT
  return runningSnapshot(record, liveReplay(record))
}

type TerminalOpenDecision = ReturnType<typeof decideTerminalOpen>

function missingCwdSnapshot(
  record: TerminalRecord | undefined,
  decision: Extract<TerminalOpenDecision, { readonly kind: 'cwd-missing' }>,
): TerminalAttachResult {
  const activity = record?.activity
  const portPreviews = activity?.portPreviews ?? []
  // The decision is made before shutdown. Re-read the live record after its
  // resource/public drain so final PTY output is included in this snapshot.
  const persisted = record?.scrollback.toString() ?? decision.persisted
  return {
    history: clampReplay(coldTerminalReplay(persisted)),
    outputBytes: 0,
    outputGeneration: record?.outputGeneration ?? 0,
    readiness: null,
    pendingInputBytes: 0,
    running: false,
    cwdMissing: true,
    processName: activity?.processName ?? null,
    ports: activity?.ports ?? [],
    ...(portPreviews.length === 0 ? {} : { portPreviews }),
    projectActionPending: Boolean(record?.projectAction),
  }
}

function createTerminalRecord(
  context: TerminalActionContext,
  input: TerminalOpenInput,
  decision: Extract<TerminalOpenDecision, { readonly kind: 'create' }>,
) {
  const cwd = validateTerminalCwd(input.cwd) ?? input.cwd
  const created = context.runtime.makeRecord(input, cwd)
  context.runtime.records.set(created.key, created)
  const persisted = coldTerminalReplay(decision.persisted)
  created.scrollback.append(persisted)
  adoptPreOpenInput(context, created)
  context.runtime.spawn(created, input.cols, input.rows)
  return runningSnapshot(created, persisted)
}

async function restartExistingTerminal(
  runtime: TerminalRuntime,
  record: TerminalRecord,
  input: TerminalOpenInput,
) {
  if (!(await runtime.killLive(record))) throw new Error('Terminal process could not be stopped.')
  await requireDetachedOutputDrain(runtime, [record])
  const replay = coldTerminalReplay(record.scrollback.toString())
  record.scrollback.reset()
  record.scrollback.append(replay)
  runtime.spawn(record, input.cols, input.rows)
  return runningSnapshot(record, replay)
}

async function applyOpenDecision(
  context: TerminalActionContext,
  input: TerminalOpenInput,
  record: TerminalRecord | undefined,
  decision: TerminalOpenDecision,
): Promise<TerminalAttachResult> {
  const { runtime } = context
  if (decision.kind === 'cwd-missing') {
    // `live === null` can still mean an asynchronous spawn is settling. Always
    // route an existing record through bounded shutdown so a context change to
    // a vanished path cannot let the old shell appear after this snapshot.
    if (record !== undefined && !(await runtime.killLive(record))) {
      throw new Error('Terminal process could not be stopped.')
    }
    if (record !== undefined) await requireDetachedOutputDrain(runtime, [record])
    return missingCwdSnapshot(record, decision)
  }
  if (decision.kind === 'reuse') return reuseLiveTerminal(record, input)
  if (decision.kind === 'reuse-spawning') return reuseSpawningTerminal(record)
  if (decision.kind === 'create') return createTerminalRecord(context, input, decision)
  if (record === undefined) return CLOSED_SNAPSHOT
  if (decision.kind === 'context-change' || record.cwd !== input.cwd) {
    return respawnForChangedContext(runtime, record, input)
  }
  return restartExistingTerminal(runtime, record, input)
}

async function respawnForChangedContext(
  runtime: TerminalRuntime,
  record: TerminalRecord,
  input: TerminalOpenInput,
) {
  if (!(await runtime.killLive(record))) throw new Error('Terminal process could not be stopped.')
  await requireDetachedOutputDrain(runtime, [record])
  runtime.prepareProjectActionForRestart(record)
  await resetPersistedHistory(runtime, record.key)
  record.closed = false
  record.cwd = validateTerminalCwd(input.cwd) ?? record.cwd
  await runtime.history.registerWorkingDirectory(record.key, record.cwd)
  if (input.env !== undefined) record.env = normalizeTerminalEnvironment(input.env)
  record.scrollback.reset()
  record.sanitizer = createTerminalHistorySanitizer()
  record.outputBytes = 0
  runtime.discardPendingOutput(record.key)
  runtime.spawn(record, input.cols, input.rows)
  return runningSnapshot(record, '')
}

async function requireDetachedOutputDrain(
  runtime: TerminalRuntime,
  records: readonly TerminalRecord[],
) {
  if (await runtime.shutdownDetachedProcesses(records)) return
  throw new Error('Terminal output and native resources did not finish draining.')
}
