import type { TerminalReadinessSnapshot } from '@shared/types/terminal'
import { terminalKeyOf } from '@shared/types/terminal'
import type {
  TerminalInputDispatchSnapshot,
  TerminalInputWriter,
} from './terminal-input-dispatch-types'
import {
  clearTerminalInputQueue,
  createTerminalInputQueue,
  type TerminalInputQueue,
  terminalInputQueueLength,
} from './terminal-input-queue'

export type TerminalInputErrorKind = 'capacity' | 'operation' | 'transport' | 'retired'

export interface TerminalInputState {
  ownerKey: string
  readonly terminalId: string
  readonly generation: string
  inputIncarnation: string | null
  awaitingAttach: boolean
  pendingReadiness: {
    readonly incarnation: string
    readonly readiness: TerminalReadinessSnapshot
  } | null
  readonly queue: TerminalInputQueue
  readonly listeners: Set<(snapshot: TerminalInputDispatchSnapshot) => void>
  operationTail: Promise<void>
  clients: number
  disposed: boolean
  draining: boolean
  open: boolean
  openVersion: number
  queueVersion: number
  operationVersion: number
  remotePendingBytes: number
  pendingOperations: number
  nextSequence: number
  readiness: TerminalReadinessSnapshot | null
  waiting: boolean
  blocked: boolean
  error: string | null
  errorKind: TerminalInputErrorKind | null
}

export interface TerminalInputDispatcherContext {
  readonly states: Map<string, TerminalInputState>
  readonly write: TerminalInputWriter
  readonly maxPendingBytes: number
  readonly maxPendingOperations: number
  readonly createGeneration: () => string
}

const READINESS_RANK = { spawning: 0, 'awaiting-prompt': 1, ready: 2 } as const

export function createTerminalInputState(
  ownerKey: string,
  terminalId: string,
  generation: string,
): TerminalInputState {
  return {
    ownerKey,
    terminalId,
    generation,
    inputIncarnation: null,
    awaitingAttach: false,
    pendingReadiness: null,
    queue: createTerminalInputQueue(),
    listeners: new Set(),
    operationTail: Promise.resolve(),
    clients: 0,
    disposed: false,
    draining: false,
    open: false,
    openVersion: 0,
    queueVersion: 0,
    operationVersion: 0,
    remotePendingBytes: 0,
    pendingOperations: 0,
    nextSequence: 0,
    readiness: null,
    waiting: false,
    blocked: false,
    error: null,
    errorKind: null,
  }
}

export function terminalInputSnapshot(state: TerminalInputState): TerminalInputDispatchSnapshot {
  return {
    waiting: state.waiting,
    error: state.error,
    queuedChunks: terminalInputQueueLength(state.queue),
  }
}

export function emitTerminalInputState(state: TerminalInputState) {
  const value = terminalInputSnapshot(state)
  for (const listener of state.listeners) listener(value)
}

export function deleteTerminalInputStateIfUnused(
  context: TerminalInputDispatcherContext,
  state: TerminalInputState,
) {
  if (
    state.clients > 0 ||
    state.draining ||
    state.open ||
    terminalInputQueueLength(state.queue) > 0 ||
    state.pendingOperations > 0
  ) {
    return
  }
  const key = terminalKeyOf(state.ownerKey, state.terminalId)
  if (context.states.get(key) === state) context.states.delete(key)
}

export function setTerminalInputError(
  state: TerminalInputState,
  kind: TerminalInputErrorKind,
  message: string,
  options: { readonly blocked: boolean; readonly waiting: boolean },
) {
  state.waiting = options.waiting
  state.blocked = options.blocked
  state.error = message
  state.errorKind = kind
  emitTerminalInputState(state)
}

export function clearTerminalInputError(state: TerminalInputState) {
  state.blocked = false
  state.error = null
  state.errorKind = null
  state.waiting = state.remotePendingBytes > 0
}

function closeTerminalInputState(
  context: TerminalInputDispatcherContext,
  state: TerminalInputState,
) {
  state.open = false
  state.awaitingAttach = false
  state.openVersion += 1
  state.queueVersion += 1
  state.operationVersion += 1
  clearTerminalInputQueue(state.queue)
  state.remotePendingBytes = 0
  state.readiness = null
  state.waiting = false
  state.blocked = false
  state.error = null
  state.errorKind = null
  emitTerminalInputState(state)
  deleteTerminalInputStateIfUnused(context, state)
}

/** A new native record cannot inherit uncertain input intended for its predecessor. */
export function attachTerminalInputIncarnation(
  context: TerminalInputDispatcherContext,
  state: TerminalInputState,
  incarnation: string,
) {
  if (state.inputIncarnation !== null && state.inputIncarnation !== incarnation) {
    const retiredInput = terminalInputQueueLength(state.queue) > 0
    closeTerminalInputState(context, state)
    state.draining = false
    state.nextSequence = 0
    state.pendingOperations = 0
    // A slow clipboard read from the old record must not hold new operations.
    state.operationTail = Promise.resolve()
    if (retiredInput) {
      setTerminalInputError(
        state,
        'retired',
        'The previous terminal stopped. Queued input was not sent. Reopen or restart the terminal before typing again.',
        { blocked: true, waiting: false },
      )
    }
  }
  state.inputIncarnation = incarnation
  state.awaitingAttach = false
}

export function disposeTerminalInputState(
  context: TerminalInputDispatcherContext,
  state: TerminalInputState,
) {
  if (state.disposed) return
  state.disposed = true
  closeTerminalInputState(context, state)
  const key = terminalKeyOf(state.ownerKey, state.terminalId)
  if (context.states.get(key) === state) context.states.delete(key)
}

export function applyTerminalReadiness(state: TerminalInputState, next: TerminalReadinessSnapshot) {
  const current = state.readiness
  const advances =
    current === null ||
    next.generation > current.generation ||
    (next.generation === current.generation &&
      READINESS_RANK[next.phase] >= READINESS_RANK[current.phase])
  if (!advances) return false
  state.readiness = next
  return true
}

export function normalizePendingInputBytes(pendingInputBytes: number) {
  return Number.isSafeInteger(pendingInputBytes) && pendingInputBytes > 0 ? pendingInputBytes : 0
}
