import type { TerminalKey } from '@shared/types/terminal'
import {
  activateTerminalInputGeneration,
  type PendingTerminalInput,
} from './terminal-input-idempotency'
import type { TerminalRecord } from './terminal-records'

interface TerminalLaunchInputContext {
  readonly runtime: { readonly records: Map<string, TerminalRecord> }
  readonly pendingInputByKey: Map<TerminalKey, PendingTerminalInput>
  readonly inFlightOpens: ReadonlyMap<TerminalKey, unknown>
}

function emptyPendingTerminalInput(): PendingTerminalInput {
  return {
    parts: [],
    bytes: 0,
    inputGeneration: null,
    lastInputReceipt: null,
    projectAction: null,
  }
}

/**
 * Renderer generation ownership follows invoke order, not the later execution
 * order of serialized lifecycle bodies. An empty pre-open state carries that
 * ownership across an earlier launch that has not created its record yet.
 */
export function activateInputGenerationForLaunch(
  context: TerminalLaunchInputContext,
  key: TerminalKey,
  generation: string | undefined,
) {
  if (generation === undefined) return
  const existing = context.runtime.records.get(key)
  if (existing !== undefined) {
    activateTerminalInputGeneration(existing, generation)
    return
  }
  const pending = context.pendingInputByKey.get(key) ?? emptyPendingTerminalInput()
  activateTerminalInputGeneration(pending, generation)
  context.pendingInputByKey.set(key, pending)
}

export function discardEmptyPendingLaunchState(
  context: TerminalLaunchInputContext,
  key: TerminalKey,
) {
  const pending = context.pendingInputByKey.get(key)
  if (
    pending !== undefined &&
    pending.parts.length === 0 &&
    pending.bytes === 0 &&
    pending.projectAction === null &&
    !context.inFlightOpens.has(key) &&
    !context.runtime.records.has(key)
  ) {
    context.pendingInputByKey.delete(key)
  }
}

export function adoptPreOpenInput(context: TerminalLaunchInputContext, record: TerminalRecord) {
  const pending = context.pendingInputByKey.get(record.key)
  if (pending === undefined) return
  context.pendingInputByKey.delete(record.key)
  record.pendingInput = pending.parts
  record.pendingInputBytes = pending.bytes
  record.inputGeneration = pending.inputGeneration
  record.lastInputReceipt = pending.lastInputReceipt
  record.projectAction = pending.projectAction
}
