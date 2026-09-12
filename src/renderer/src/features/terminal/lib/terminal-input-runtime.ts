import type { TerminalInputReleaseResult, TerminalReadinessSnapshot } from '@shared/types/terminal'
import {
  applyTerminalReadiness,
  clearTerminalInputError,
  deleteTerminalInputStateIfUnused,
  emitTerminalInputState,
  normalizePendingInputBytes,
  setTerminalInputError,
  type TerminalInputDispatcherContext,
  type TerminalInputState,
} from './terminal-input-dispatch-state'
import type {
  TerminalInputEnqueueResult,
  TerminalProjectActionEnqueueResult,
} from './terminal-input-dispatch-types'
import {
  appendTerminalInput,
  appendTerminalInputPlaceholder,
  appendTerminalProjectAction,
  hasQueuedTerminalProjectAction,
  removeTerminalInputPlaceholder,
  resolveTerminalInputPlaceholder,
} from './terminal-input-queue'
import { drainTerminalInput } from './terminal-input-transport'

const INACTIVE_INPUT_ERROR = 'Terminal input is no longer available.'
const QUEUE_CAPACITY_ERROR =
  'Terminal input was not sent because pending input is limited to 2 MiB. Wait for queued input to send, then paste a smaller selection.'
const OPERATION_CAPACITY_ERROR =
  'Too many clipboard reads are pending. Wait for the current paste, then try again.'
const PROJECT_ACTION_CAPACITY_ERROR =
  'The Project Action command was not sent because terminal input capacity is full.'
const PROJECT_ACTION_PENDING_ERROR = 'Another Project Action is already pending in this terminal.'

function inactiveResult(): TerminalInputEnqueueResult {
  return { status: 'rejected', reason: 'inactive', error: INACTIVE_INPUT_ERROR }
}

function capacityResult(state: TerminalInputState, error: string): TerminalInputEnqueueResult {
  setTerminalInputError(state, 'capacity', error, {
    blocked: false,
    waiting: state.remotePendingBytes > 0,
  })
  return { status: 'rejected', reason: 'capacity', error }
}

export function enqueueTerminalInput(
  context: TerminalInputDispatcherContext,
  state: TerminalInputState,
  data: string,
): TerminalInputEnqueueResult {
  if (state.disposed) return inactiveResult()
  if (data.length === 0) return { status: 'accepted' }
  const remainingBytes = Math.max(
    0,
    context.maxPendingBytes - state.remotePendingBytes - state.queue.byteLength,
  )
  const result = appendTerminalInput(state.queue, data, remainingBytes)
  if (result.status === 'capacity') return capacityResult(state, QUEUE_CAPACITY_ERROR)

  if (state.errorKind === 'capacity' || state.errorKind === 'operation') {
    clearTerminalInputError(state)
    emitTerminalInputState(state)
  }
  void drainTerminalInput(context, state)
  return { status: 'accepted' }
}

export function enqueueTerminalProjectAction(
  context: TerminalInputDispatcherContext,
  state: TerminalInputState,
  data: string,
  executionId: string,
): Promise<TerminalProjectActionEnqueueResult> {
  if (state.disposed) return Promise.resolve(inactiveResult())
  if (hasQueuedTerminalProjectAction(state.queue)) {
    return Promise.resolve({
      status: 'rejected',
      reason: 'project-action-pending',
      error: PROJECT_ACTION_PENDING_ERROR,
    })
  }
  if (data.length === 0 || executionId.length === 0) {
    return Promise.resolve({
      status: 'rejected',
      reason: 'transport',
      error: 'The Project Action command is invalid.',
    })
  }

  return new Promise<TerminalProjectActionEnqueueResult>((resolve) => {
    let settled = false
    const settle = (result: TerminalProjectActionEnqueueResult) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    const remainingBytes = Math.max(
      0,
      context.maxPendingBytes - state.remotePendingBytes - state.queue.byteLength,
    )
    const result = appendTerminalProjectAction(
      state.queue,
      data,
      remainingBytes,
      executionId,
      settle,
    )
    if (result.status === 'capacity') {
      settle({
        status: 'rejected',
        reason: 'capacity',
        error: PROJECT_ACTION_CAPACITY_ERROR,
      })
      return
    }
    if (state.errorKind === 'capacity' || state.errorKind === 'operation') {
      clearTerminalInputError(state)
      emitTerminalInputState(state)
    }
    void drainTerminalInput(context, state)
  })
}

function recordOperationError(state: TerminalInputState, error: unknown) {
  const message =
    error instanceof Error ? error.message : 'Clipboard could not be read. Check access and retry.'
  setTerminalInputError(state, 'operation', message, {
    blocked: false,
    waiting: state.remotePendingBytes > 0,
  })
}

export function enqueueTerminalInputAsync(
  context: TerminalInputDispatcherContext,
  state: TerminalInputState,
  resolveData: () => Promise<string>,
): Promise<TerminalInputEnqueueResult> {
  if (state.pendingOperations >= context.maxPendingOperations) {
    return Promise.resolve(capacityResult(state, OPERATION_CAPACITY_ERROR))
  }
  const operationVersion = state.operationVersion
  const placeholder = appendTerminalInputPlaceholder(state.queue)
  state.pendingOperations += 1
  const operation = state.operationTail.then(async (): Promise<TerminalInputEnqueueResult> => {
    if (state.disposed || state.operationVersion !== operationVersion) {
      removeTerminalInputPlaceholder(state.queue, placeholder)
      return inactiveResult()
    }
    let data: string
    try {
      data = await resolveData()
    } catch (error) {
      if (!state.disposed && state.operationVersion === operationVersion) {
        removeTerminalInputPlaceholder(state.queue, placeholder)
        recordOperationError(state, error)
        void drainTerminalInput(context, state)
      }
      throw error
    }
    if (state.disposed || state.operationVersion !== operationVersion) {
      removeTerminalInputPlaceholder(state.queue, placeholder)
      return inactiveResult()
    }
    const remainingBytes = Math.max(
      0,
      context.maxPendingBytes - state.remotePendingBytes - state.queue.byteLength,
    )
    const result = resolveTerminalInputPlaceholder(state.queue, placeholder, data, remainingBytes)
    if (result.status === 'inactive') return inactiveResult()
    if (result.status === 'capacity') {
      void drainTerminalInput(context, state)
      return capacityResult(state, QUEUE_CAPACITY_ERROR)
    }
    if (state.errorKind === 'capacity' || state.errorKind === 'operation') {
      clearTerminalInputError(state)
    }
    emitTerminalInputState(state)
    void drainTerminalInput(context, state)
    return { status: 'accepted' }
  })
  const finalized = operation.finally(() => {
    state.pendingOperations = Math.max(0, state.pendingOperations - 1)
    deleteTerminalInputStateIfUnused(context, state)
  })
  state.operationTail = finalized.then(
    () => undefined,
    () => undefined,
  )
  return finalized
}

export function markTerminalInputOpen(
  context: TerminalInputDispatcherContext,
  state: TerminalInputState,
  readiness: TerminalReadinessSnapshot | null,
  pendingInputBytes: number,
) {
  state.open = true
  state.openVersion += 1
  const applied = readiness === null || applyTerminalReadiness(state, readiness)
  if (applied && readiness?.phase === 'ready') {
    state.remotePendingBytes = 0
    if (state.errorKind !== 'capacity' && state.errorKind !== 'operation') {
      clearTerminalInputError(state)
    }
  }
  if (applied && readiness !== null && readiness.phase !== 'ready') {
    state.remotePendingBytes = normalizePendingInputBytes(pendingInputBytes)
    if (state.errorKind === 'transport') clearTerminalInputError(state)
  }
  emitTerminalInputState(state)
  void drainTerminalInput(context, state)
}

/** Enable transport staging without claiming that the shell or prompt is ready. */
export function markTerminalInputOpening(
  context: TerminalInputDispatcherContext,
  state: TerminalInputState,
) {
  state.open = true
  state.openVersion += 1
  state.readiness = null
  if (state.errorKind === 'transport') clearTerminalInputError(state)
  emitTerminalInputState(state)
  void drainTerminalInput(context, state)
}

export function markTerminalInputReady(
  context: TerminalInputDispatcherContext,
  state: TerminalInputState,
  readiness: TerminalReadinessSnapshot,
) {
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

export function applyTerminalInputRelease(
  context: TerminalInputDispatcherContext,
  state: TerminalInputState,
  result: TerminalInputReleaseResult,
) {
  if (result.status === 'terminal-not-open') {
    state.open = false
    state.openVersion += 1
    setTerminalInputError(
      state,
      'transport',
      'Terminal input is waiting for the shell to reopen.',
      {
        blocked: true,
        waiting: false,
      },
    )
    return
  }
  state.remotePendingBytes = 0
  clearTerminalInputError(state)
  emitTerminalInputState(state)
  void drainTerminalInput(context, state)
}

export function retryTerminalInput(
  context: TerminalInputDispatcherContext,
  state: TerminalInputState,
) {
  clearTerminalInputError(state)
  emitTerminalInputState(state)
  void drainTerminalInput(context, state)
}
