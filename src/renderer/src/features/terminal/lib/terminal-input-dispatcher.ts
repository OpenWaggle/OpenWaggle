import { TERMINAL } from '@shared/constants/resource-limits'
import { terminalKeyOf } from '@shared/types/terminal'
import { api } from '@/shared/lib/ipc'
import {
  markTerminalInputOpen,
  markTerminalInputOpening,
  markTerminalInputReady,
} from './terminal-input-attachment'
import {
  createTerminalInputState,
  deleteTerminalInputStateIfUnused,
  disposeTerminalInputState,
  emitTerminalInputState,
  type TerminalInputDispatcherContext,
  type TerminalInputState,
  terminalInputSnapshot,
} from './terminal-input-dispatch-state'
import type {
  TerminalInputClient,
  TerminalInputDispatcher,
  TerminalInputDispatcherOptions,
  TerminalInputWriter,
} from './terminal-input-dispatch-types'
import { hasQueuedTerminalProjectAction } from './terminal-input-queue'
import {
  applyTerminalInputRelease,
  enqueueTerminalInput,
  enqueueTerminalInputAsync,
  enqueueTerminalProjectAction,
  retryTerminalInput,
} from './terminal-input-runtime'
import { drainTerminalInput } from './terminal-input-transport'

export type {
  TerminalInputClient,
  TerminalInputDispatcher,
  TerminalInputDispatcherOptions,
  TerminalInputDispatchSnapshot,
  TerminalInputEnqueueResult,
  TerminalProjectActionEnqueueResult,
} from './terminal-input-dispatch-types'

const MAX_PENDING_ASYNC_INPUT_OPERATIONS = 8

function getOrCreate(
  context: TerminalInputDispatcherContext,
  ownerKey: string,
  terminalId: string,
) {
  const key = terminalKeyOf(ownerKey, terminalId)
  const existing = context.states.get(key)
  if (existing !== undefined) return existing
  const state = createTerminalInputState(ownerKey, terminalId, context.createGeneration())
  context.states.set(key, state)
  return state
}

function createClient(
  context: TerminalInputDispatcherContext,
  state: TerminalInputState,
): TerminalInputClient {
  let released = false
  const inactive = () => released || state.disposed
  state.clients += 1
  return {
    generation: state.generation,
    get inputIncarnation() {
      return state.inputIncarnation
    },
    enqueue(data) {
      if (inactive()) {
        return {
          status: 'rejected',
          reason: 'inactive',
          error: 'Terminal input is no longer available.',
        }
      }
      return enqueueTerminalInput(context, state, data)
    },
    enqueueAsync(resolveData) {
      if (inactive()) {
        return Promise.resolve({
          status: 'rejected',
          reason: 'inactive',
          error: 'Terminal input is no longer available.',
        })
      }
      return enqueueTerminalInputAsync(context, state, resolveData)
    },
    enqueueProjectAction(data, executionId) {
      if (inactive()) {
        return Promise.resolve({
          status: 'rejected',
          reason: 'inactive',
          error: 'Terminal input is no longer available.',
        })
      }
      return enqueueTerminalProjectAction(context, state, data, executionId)
    },
    markOpening() {
      return inactive() ? () => undefined : markTerminalInputOpening(context, state)
    },
    markOpen(readiness, pendingInputBytes = 0, inputIncarnation) {
      if (!inactive()) {
        markTerminalInputOpen(context, state, readiness, pendingInputBytes, inputIncarnation)
      }
    },
    markUnavailable() {
      if (inactive()) return
      state.open = false
      state.openVersion += 1
    },
    markClosed() {
      if (!inactive()) disposeTerminalInputState(context, state)
    },
    markReady(readiness, inputIncarnation) {
      if (!inactive()) markTerminalInputReady(context, state, readiness, inputIncarnation)
    },
    applyReleaseResult(result) {
      if (!inactive()) applyTerminalInputRelease(context, state, result)
    },
    retry() {
      if (!inactive()) retryTerminalInput(context, state)
    },
    snapshot: () => terminalInputSnapshot(state),
    subscribe(listener) {
      if (inactive()) return () => undefined
      state.listeners.add(listener)
      listener(terminalInputSnapshot(state))
      return () => state.listeners.delete(listener)
    },
    release() {
      if (released) return
      released = true
      state.clients = Math.max(0, state.clients - 1)
      deleteTerminalInputStateIfUnused(context, state)
    },
  }
}

function assertOwnerMigrationAvailable(
  context: TerminalInputDispatcherContext,
  fromOwnerKey: string,
  toOwnerKey: string,
  terminalIds: readonly string[],
) {
  if (fromOwnerKey === toOwnerKey) return
  for (const terminalId of terminalIds) {
    const source = context.states.get(terminalKeyOf(fromOwnerKey, terminalId))
    if (source === undefined) continue
    const toKey = terminalKeyOf(toOwnerKey, terminalId)
    const destination = context.states.get(toKey)
    if (destination !== undefined && destination !== source) {
      throw new Error(`Terminal input state already exists for ${toKey}.`)
    }
  }
}

function migrateOwner(
  context: TerminalInputDispatcherContext,
  fromOwnerKey: string,
  toOwnerKey: string,
  terminalIds: readonly string[],
) {
  assertOwnerMigrationAvailable(context, fromOwnerKey, toOwnerKey, terminalIds)
  if (fromOwnerKey === toOwnerKey) return
  for (const terminalId of terminalIds) {
    const fromKey = terminalKeyOf(fromOwnerKey, terminalId)
    const state = context.states.get(fromKey)
    if (state === undefined) continue
    context.states.delete(fromKey)
    state.ownerKey = toOwnerKey
    context.states.set(terminalKeyOf(toOwnerKey, terminalId), state)
    emitTerminalInputState(state)
    void drainTerminalInput(context, state)
  }
}

function clearOwner(context: TerminalInputDispatcherContext, ownerKey: string) {
  for (const state of context.states.values()) {
    if (state.ownerKey === ownerKey) disposeTerminalInputState(context, state)
  }
}

function positiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer.`)
  }
  return value
}

/** One ordered input stream per runtime, durable across React viewport moves. */
export function createTerminalInputDispatcher(
  write: TerminalInputWriter,
  options: TerminalInputDispatcherOptions = {},
): TerminalInputDispatcher {
  const context: TerminalInputDispatcherContext = {
    states: new Map(),
    write,
    maxPendingBytes: positiveInteger(
      options.maxPendingBytes ?? TERMINAL.MAX_PENDING_INPUT_BYTES,
      'Terminal pending input capacity',
    ),
    maxPendingOperations: positiveInteger(
      options.maxPendingOperations ?? MAX_PENDING_ASYNC_INPUT_OPERATIONS,
      'Terminal pending input operation capacity',
    ),
    createGeneration: options.createGeneration ?? (() => globalThis.crypto.randomUUID()),
  }
  return {
    acquire: (ownerKey, terminalId) =>
      createClient(context, getOrCreate(context, ownerKey, terminalId)),
    hasPendingProjectAction: (ownerKey, terminalId) => {
      const state = context.states.get(terminalKeyOf(ownerKey, terminalId))
      return state !== undefined && hasQueuedTerminalProjectAction(state.queue)
    },
    assertOwnerMigrationAvailable: (fromOwnerKey, toOwnerKey, terminalIds) =>
      assertOwnerMigrationAvailable(context, fromOwnerKey, toOwnerKey, terminalIds),
    migrateOwner: (fromOwnerKey, toOwnerKey, terminalIds) =>
      migrateOwner(context, fromOwnerKey, toOwnerKey, terminalIds),
    clearOwner: (ownerKey) => clearOwner(context, ownerKey),
  }
}

export const terminalInputDispatcher = createTerminalInputDispatcher(
  (ownerKey, terminalId, data, identity, intent) =>
    intent === undefined
      ? api.writeTerminal(ownerKey, terminalId, data, identity)
      : api.writeTerminal(ownerKey, terminalId, data, identity, intent),
)
