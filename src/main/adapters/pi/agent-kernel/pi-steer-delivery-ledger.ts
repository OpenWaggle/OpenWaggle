import type { AgentSession } from '@earendil-works/pi-coding-agent'
import type {
  SteeringDelivery,
  UndeliveredSteer,
} from '../../../domain/session-control/undelivered-steering'
import { stripAtomicVisualizationContext } from '../pi-runtime-input'

export interface DeliveryTracker {
  readonly entriesBefore: number
  readonly steerTextsBefore: readonly string[]
  readonly inFlightUserTextsBefore: ReadonlyMap<string, number>
  readonly candidates: Array<{ readonly message: object; readonly originalText: string }>
}

/** Snapshot what Pi already holds, so an identical earlier message is not taken for this steer. */
export function createDeliveryTracker(input: {
  readonly session: Pick<AgentSession, 'sessionManager' | 'getSteeringMessages'>
  readonly inFlightUserTexts: ReadonlyMap<string, number>
  readonly inFlightMessages: ReadonlyMap<object, string>
}): DeliveryTracker {
  return {
    entriesBefore: input.session.sessionManager.getEntries().length,
    steerTextsBefore: [...(input.session.getSteeringMessages?.() ?? [])],
    inFlightUserTextsBefore: new Map(input.inFlightUserTexts),
    candidates: [...input.inFlightMessages].map(([message, originalText]) => ({
      message,
      originalText,
    })),
  }
}

/**
 * One steer that names its delivery, in arrival order. `awaiting-handoff` has not reached Pi
 * (for example it waits for compaction); `queued` sits in Pi's steering queue; `settled` was
 * handled by an extension, failed, or was refused, and is never handed back.
 */
export interface SteerLedgerEntry {
  readonly delivery: SteeringDelivery
  stage: 'awaiting-handoff' | 'queued' | 'settled'
  queued?: { readonly tracker: DeliveryTracker; readonly durableText: string }
}

/** Ended Runs' Undelivered steering messages, until Session Control takes them at settlement. */
const undeliveredSteersByRun = new Map<string, readonly UndeliveredSteer[]>()
const MAX_RETAINED_UNDELIVERED_RUNS = 256

/**
 * The Pi user message a tracked steer became, once Pi started incorporating it (message_start).
 * Earlier identical steers and in-flight messages are skipped so they are not mistaken for it.
 */
export function deliveryCandidate(tracker: DeliveryTracker, durableText: string) {
  const matchingSteersBefore = tracker.steerTextsBefore.filter(
    (text) => stripAtomicVisualizationContext(text) === durableText,
  ).length
  const matchingInFlightBefore = tracker.inFlightUserTextsBefore.get(durableText) ?? 0
  return tracker.candidates.filter((candidate) => candidate.originalText === durableText)[
    matchingSteersBefore + matchingInFlightBefore
  ]
}

export function retainUndeliveredSteers(runId: string, ledger: readonly SteerLedgerEntry[]) {
  const undelivered = ledger.flatMap((entry): UndeliveredSteer[] => {
    if (entry.stage === 'awaiting-handoff') return [{ delivery: entry.delivery, handedOff: false }]
    if (entry.stage !== 'queued' || !entry.queued) return []
    // Pi started incorporating this message; handing it back would deliver it twice.
    if (deliveryCandidate(entry.queued.tracker, entry.queued.durableText)) return []
    return [{ delivery: entry.delivery, handedOff: true }]
  })
  if (undelivered.length === 0) return
  undeliveredSteersByRun.delete(runId)
  undeliveredSteersByRun.set(runId, undelivered)
  while (undeliveredSteersByRun.size > MAX_RETAINED_UNDELIVERED_RUNS) {
    const oldest = undeliveredSteersByRun.keys().next()
    if (oldest.done) break
    undeliveredSteersByRun.delete(oldest.value)
  }
}

/** Hand out, once, the steers an ended Run never started incorporating. */
export function takeUndeliveredPiSteers(runId: string): readonly UndeliveredSteer[] {
  const undelivered = undeliveredSteersByRun.get(runId) ?? []
  undeliveredSteersByRun.delete(runId)
  return undelivered
}
