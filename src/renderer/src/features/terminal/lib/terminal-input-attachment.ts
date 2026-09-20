import type {
  TerminalAttachResult,
  TerminalInputReleaseResult,
  TerminalReadinessSnapshot,
} from '@shared/types/terminal'
import {
  applyTerminalReadiness,
  attachTerminalInputIncarnation,
  clearTerminalInputError,
  emitTerminalInputState,
  normalizePendingInputBytes,
  setTerminalInputError,
  type TerminalInputDispatcherContext,
  type TerminalInputState,
} from './terminal-input-dispatch-state'
import type { TerminalInputClient } from './terminal-input-dispatch-types'
import { drainTerminalInput } from './terminal-input-transport'

export function attachTerminalInputClient(
  client: TerminalInputClient,
  snapshot: TerminalAttachResult,
) {
  client.markOpen(snapshot.readiness, snapshot.pendingInputBytes, snapshot.inputIncarnation)
}

export function createTerminalInputReleaseHandler(
  client: TerminalInputClient,
  release: (incarnation: string) => Promise<TerminalInputReleaseResult>,
  isCurrent: () => boolean,
) {
  return async () => {
    const incarnation = client.inputIncarnation
    if (incarnation === null) return
    const current = () => isCurrent() && client.inputIncarnation === incarnation
    try {
      const result = await release(incarnation)
      if (current()) client.applyReleaseResult(result)
    } catch (error) {
      if (current()) throw error
    }
  }
}

function applyAttachIdentity(
  context: TerminalInputDispatcherContext,
  state: TerminalInputState,
  inputIncarnation: string | undefined,
) {
  if (inputIncarnation === undefined && state.awaitingAttach) {
    setTerminalInputError(state, 'transport', 'Terminal input identity could not be verified.', {
      blocked: true,
      waiting: false,
    })
    return false
  }
  if (state.errorKind === 'retired') clearTerminalInputError(state)
  if (inputIncarnation !== undefined) {
    attachTerminalInputIncarnation(context, state, inputIncarnation)
  }
  return true
}

export function markTerminalInputOpen(
  context: TerminalInputDispatcherContext,
  state: TerminalInputState,
  readiness: TerminalReadinessSnapshot | null,
  pendingInputBytes: number,
  inputIncarnation?: string,
) {
  if (!applyAttachIdentity(context, state, inputIncarnation)) return
  const pending = state.pendingReadiness
  state.pendingReadiness = null
  if (pending?.incarnation === state.inputIncarnation) {
    applyTerminalReadiness(state, pending.readiness)
  }
  state.open = true
  state.openVersion += 1
  const applied = readiness === null || applyTerminalReadiness(state, readiness)
  if (state.readiness?.phase === 'ready') {
    state.remotePendingBytes = 0
    if (
      state.errorKind !== 'capacity' &&
      state.errorKind !== 'operation' &&
      state.errorKind !== 'retired'
    ) {
      clearTerminalInputError(state)
    }
  }
  if (applied && state.readiness !== null && state.readiness.phase !== 'ready') {
    state.remotePendingBytes = normalizePendingInputBytes(pendingInputBytes)
    if (state.errorKind === null) state.waiting = state.remotePendingBytes > 0
    if (state.errorKind === 'transport') clearTerminalInputError(state)
  }
  emitTerminalInputState(state)
  void drainTerminalInput(context, state)
}

/** The attach snapshot arrives before prompt readiness and identifies the native record. */
export function markTerminalInputOpening(
  context: TerminalInputDispatcherContext,
  state: TerminalInputState,
) {
  const previous = {
    open: state.open,
    awaitingAttach: state.awaitingAttach,
    readiness: state.readiness,
    incarnation: state.inputIncarnation,
    pendingReadiness: state.pendingReadiness,
  }
  state.open = false
  state.awaitingAttach = true
  state.pendingReadiness = null
  state.openVersion += 1
  state.readiness = null
  if (state.errorKind === 'transport') clearTerminalInputError(state)
  emitTerminalInputState(state)
  const openVersion = state.openVersion
  return () => {
    if (
      state.disposed ||
      state.openVersion !== openVersion ||
      state.inputIncarnation !== previous.incarnation
    )
      return
    const observedReadiness = state.pendingReadiness
    state.open = previous.open
    state.awaitingAttach = previous.awaitingAttach
    state.readiness = previous.readiness
    state.pendingReadiness = previous.pendingReadiness
    state.openVersion += 1
    if (observedReadiness?.incarnation === previous.incarnation) {
      markTerminalInputReady(
        context,
        state,
        observedReadiness.readiness,
        observedReadiness.incarnation,
      )
    }
    emitTerminalInputState(state)
    void drainTerminalInput(context, state)
  }
}

export function markTerminalInputReady(
  context: TerminalInputDispatcherContext,
  state: TerminalInputState,
  readiness: TerminalReadinessSnapshot,
  inputIncarnation?: string,
) {
  if (state.errorKind === 'retired') return
  if (state.awaitingAttach) {
    if (inputIncarnation !== undefined) {
      const pending = state.pendingReadiness
      if (
        pending?.incarnation !== inputIncarnation ||
        readiness.generation >= pending.readiness.generation
      ) {
        state.pendingReadiness = { incarnation: inputIncarnation, readiness }
      }
    }
    return
  }
  if (inputIncarnation !== undefined && inputIncarnation !== state.inputIncarnation) return
  if (readiness.phase !== 'ready' || !applyTerminalReadiness(state, readiness)) return
  state.open = true
  state.openVersion += 1
  state.remotePendingBytes = 0
  if (state.errorKind !== 'capacity' && state.errorKind !== 'operation') {
    clearTerminalInputError(state)
  }
  emitTerminalInputState(state)
  void drainTerminalInput(context, state)
}
