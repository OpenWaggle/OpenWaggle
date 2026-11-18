import type { TerminalInputIdentity, TerminalWriteResult } from '@shared/types/terminal'
import {
  deleteTerminalInputStateIfUnused,
  emitTerminalInputState,
  setTerminalInputError,
  type TerminalInputDispatcherContext,
  type TerminalInputState,
} from './terminal-input-dispatch-state'
import {
  type QueuedTerminalInput,
  removeTerminalInputHead,
  terminalInputQueueHead,
  terminalInputQueueLength,
} from './terminal-input-queue'

function inputError(reason: Extract<TerminalWriteResult, { status: 'rejected' }>['reason']) {
  if (reason === 'project-action-pending') {
    return 'Another Project Action is already pending in this terminal.'
  }
  if (reason === 'terminal-not-open') return 'Terminal input is waiting for the shell to reopen.'
  if (reason === 'queue-full') {
    return 'Terminal startup input is full. Choose Send now, then retry the input.'
  }
  if (reason === 'input-too-large') return 'Terminal input is too large. Paste a smaller selection.'
  if (reason === 'stale-generation') {
    return 'Terminal input came from an older view. Reopen the terminal and retry.'
  }
  if (reason === 'sequence-gap' || reason === 'sequence-conflict') {
    return 'Terminal input order could not be verified. Reopen the terminal and retry.'
  }
  return 'Terminal input could not be delivered.'
}

function isCurrentHead(
  state: TerminalInputState,
  queued: QueuedTerminalInput,
  queueVersion: number,
) {
  return (
    !state.disposed &&
    state.queueVersion === queueVersion &&
    terminalInputQueueHead(state.queue) === queued
  )
}

function acknowledgementMatches(
  result: TerminalWriteResult,
  identity: TerminalInputIdentity,
  queued: QueuedTerminalInput,
) {
  const echoedIdentity = result.identity
  if (
    echoedIdentity === undefined ||
    echoedIdentity.generation !== identity.generation ||
    echoedIdentity.incarnation !== identity.incarnation ||
    echoedIdentity.sequence !== identity.sequence
  ) {
    return false
  }
  return result.status === 'rejected' || result.acceptedBytes === queued.byteLength
}

function acceptWrite(
  state: TerminalInputState,
  queued: QueuedTerminalInput,
  result: Exclude<TerminalWriteResult, { status: 'rejected' }>,
) {
  if (!removeTerminalInputHead(state.queue, queued)) return
  state.nextSequence += 1
  queued.settle?.({ status: 'accepted' })

  const ready = state.readiness?.phase === 'ready'
  if (result.status === 'queued' && !ready) {
    state.remotePendingBytes += result.acceptedBytes
    if (state.errorKind === null) state.waiting = true
    emitTerminalInputState(state)
    return
  }
  if (ready) state.remotePendingBytes = 0
  if (state.errorKind === null) state.waiting = state.remotePendingBytes > 0
  emitTerminalInputState(state)
}

function rejectProjectAction(
  state: TerminalInputState,
  queued: QueuedTerminalInput,
  result: Extract<TerminalWriteResult, { status: 'rejected' }>,
) {
  if (!removeTerminalInputHead(state.queue, queued)) return false
  queued.settle?.({
    status: 'rejected',
    reason: result.reason === 'project-action-pending' ? 'project-action-pending' : 'transport',
    error: inputError(result.reason),
  })
  if (result.reason === 'project-action-pending') {
    emitTerminalInputState(state)
    return true
  }
  return false
}

function rejectWrite(
  state: TerminalInputState,
  result: Extract<TerminalWriteResult, { status: 'rejected' }>,
  openVersion: number,
) {
  if (state.openVersion !== openVersion) return
  if (result.reason === 'terminal-not-open') {
    state.open = false
    state.remotePendingBytes = 0
  }
  setTerminalInputError(state, 'transport', inputError(result.reason), {
    blocked: true,
    waiting: result.reason === 'queue-full' || state.remotePendingBytes > 0,
  })
}

function recordProtocolError(state: TerminalInputState) {
  setTerminalInputError(
    state,
    'transport',
    'Terminal input acknowledgement could not be verified. Reopen the terminal and retry.',
    { blocked: true, waiting: state.remotePendingBytes > 0 },
  )
}

async function writeHead(
  context: TerminalInputDispatcherContext,
  state: TerminalInputState,
  queued: QueuedTerminalInput,
) {
  const openVersion = state.openVersion
  const queueVersion = state.queueVersion
  const identity = {
    generation: state.generation,
    sequence: state.nextSequence,
    ...(state.inputIncarnation === null ? {} : { incarnation: state.inputIncarnation }),
  }
  let result: TerminalWriteResult
  try {
    result = await context.write(
      state.ownerKey,
      state.terminalId,
      queued.data,
      identity,
      queued.intent,
    )
  } catch (error) {
    if (!isCurrentHead(state, queued, queueVersion) || state.openVersion !== openVersion) return
    queued.settle?.({
      status: 'rejected',
      reason: 'transport',
      error: error instanceof Error ? error.message : 'Terminal input could not be sent.',
    })
    setTerminalInputError(
      state,
      'transport',
      error instanceof Error ? error.message : 'Terminal input could not be sent.',
      { blocked: true, waiting: state.remotePendingBytes > 0 },
    )
    return
  }
  if (!isCurrentHead(state, queued, queueVersion)) return
  if (!acknowledgementMatches(result, identity, queued)) {
    queued.settle?.({
      status: 'rejected',
      reason: 'transport',
      error: 'Terminal input acknowledgement could not be verified.',
    })
    recordProtocolError(state)
    return
  }
  if (result.status === 'rejected') {
    if (queued.intent?.kind === 'project-action' && rejectProjectAction(state, queued, result)) {
      return
    }
    rejectWrite(state, result, openVersion)
    return
  }
  acceptWrite(state, queued, result)
}

function hasDrainableInput(state: TerminalInputState) {
  return (
    !state.disposed &&
    state.open &&
    !state.blocked &&
    terminalInputQueueLength(state.queue) > 0 &&
    terminalInputQueueHead(state.queue)?.pending !== true
  )
}

export async function drainTerminalInput(
  context: TerminalInputDispatcherContext,
  state: TerminalInputState,
) {
  if (state.disposed || state.draining || !state.open || state.blocked) return
  const queueVersion = state.queueVersion
  state.draining = true
  try {
    while (!state.disposed && state.open && !state.blocked && state.queueVersion === queueVersion) {
      const queued = terminalInputQueueHead(state.queue)
      if (queued === undefined) break
      // An async clipboard read reserves its invocation position. Later keys
      // remain behind it until the placeholder resolves or is removed.
      if (queued.pending === true) break
      await writeHead(context, state, queued)
    }
  } finally {
    if (state.queueVersion === queueVersion) {
      state.draining = false
      deleteTerminalInputStateIfUnused(context, state)
      if (hasDrainableInput(state)) void drainTerminalInput(context, state)
    }
  }
}
