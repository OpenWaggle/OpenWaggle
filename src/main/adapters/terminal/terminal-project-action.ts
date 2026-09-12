import { Buffer } from 'node:buffer'
import { TERMINAL } from '@shared/constants/resource-limits'
import type { TerminalInputIntent } from '@shared/types/terminal'
import type { TerminalProjectActionState, TerminalRecord } from './terminal-records'

interface TerminalProjectActionCarrier {
  projectAction: TerminalProjectActionState | null
}

export function terminalInputByteLimit(intent: TerminalInputIntent | undefined) {
  return intent?.kind === 'project-action'
    ? TERMINAL.MAX_PROJECT_ACTION_INPUT_BYTES
    : TERMINAL.MAX_INPUT_BYTES
}

/** Claim the one action slot before the command enters any readiness queue. */
export function beginTerminalProjectAction(
  carrier: TerminalProjectActionCarrier,
  intent: TerminalInputIntent | undefined,
) {
  if (intent?.kind !== 'project-action') return true
  if (carrier.projectAction !== null) return false
  carrier.projectAction = {
    executionId: intent.executionId,
    deliveredAfterPromptEpoch: null,
    sawRunning: false,
    deliveredAtMonotonicMs: null,
    reliableIdleObservations: 0,
  }
  return true
}

export function markTerminalProjectActionDelivered(
  record: TerminalRecord,
  intent: TerminalInputIntent | undefined,
  nowMs = performance.now(),
) {
  if (intent?.kind !== 'project-action') return false
  const action = record.projectAction
  if (action === null || action.executionId !== intent.executionId) return false
  if (action.deliveredAfterPromptEpoch !== null) return false
  action.deliveredAfterPromptEpoch = record.promptEpoch
  action.deliveredAtMonotonicMs = nowMs
  action.reliableIdleObservations = 0
  return true
}

/**
 * Release the barrier. Natural exit can also discard an undelivered command;
 * restart paths pass false so accepted startup input stays user-owned.
 */
export function clearTerminalProjectAction(record: TerminalRecord, dropUndelivered: boolean) {
  const action = record.projectAction
  if (action === null) return false
  if (dropUndelivered && action.deliveredAfterPromptEpoch === null) {
    record.pendingInput = record.pendingInput.filter(
      (part) =>
        part.intent?.kind !== 'project-action' || part.intent.executionId !== action.executionId,
    )
    record.pendingInputBytes = record.pendingInput.reduce(
      (total, part) => total + Buffer.byteLength(part.data, 'utf8'),
      0,
    )
  }
  record.projectAction = null
  return true
}

/** A delivered command never crosses an explicit restart/context change. */
export function prepareTerminalProjectActionForRestart(record: TerminalRecord) {
  if (record.projectAction?.deliveredAfterPromptEpoch === null) return false
  return clearTerminalProjectAction(record, false)
}

/** Count every authenticated prompt marker and clear only after a later prompt. */
export function observeTerminalPromptMarkers(record: TerminalRecord, count: number) {
  if (!Number.isSafeInteger(count) || count <= 0) return false
  record.promptEpoch += count
  const deliveredAt = record.projectAction?.deliveredAfterPromptEpoch
  return deliveredAt !== null && deliveredAt !== undefined && record.promptEpoch > deliveredAt
    ? clearTerminalProjectAction(record, false)
    : false
}

/** Reliable running→idle fallback for shells without prompt integration. */
export function observeTerminalProjectActionActivity(
  record: TerminalRecord,
  nowMs = performance.now(),
) {
  const action = record.projectAction
  const activity = record.activity
  if (action === null || action.deliveredAfterPromptEpoch === null) return false
  if (activity?.processReliable !== true) {
    action.reliableIdleObservations = 0
    return false
  }
  if (activity.processNames.length > 0) {
    action.sawRunning = true
    action.reliableIdleObservations = 0
    return false
  }
  if (action.sawRunning) return clearTerminalProjectAction(record, false)

  action.reliableIdleObservations += 1
  const deliveredAt = action.deliveredAtMonotonicMs
  const elapsed = typeof deliveredAt === 'number' ? nowMs - deliveredAt : 0
  return action.reliableIdleObservations >= TERMINAL.PROJECT_ACTION_IDLE_FALLBACK_POLLS &&
    elapsed >= TERMINAL.PROJECT_ACTION_IDLE_FALLBACK_MS
    ? clearTerminalProjectAction(record, false)
    : false
}
