import { matchBy } from '@diegogbrisa/ts-match'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { MAX_RETURNED_STEER_OVERFLOW } from '@shared/types/session-control-returned-steers'
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
 * Where one steer that names its delivery stands, in arrival order:
 * - `awaiting-handoff`: queued behind earlier steers; Pi has not seen it.
 * - `handing-off`: Pi run control holds it (it may wait for compaction, or Pi may already have
 *   queued it). The tracker is taken here, after every earlier steer reached Pi, so an identical
 *   earlier steer is counted before this one instead of being mistaken for it.
 * - `queued`: in Pi's steering queue, as `durableText`.
 * - `settled`: handled by an extension, failed, or refused. Never handed back.
 */
export type SteerLedgerState =
  | { readonly stage: 'awaiting-handoff' }
  | { readonly stage: 'handing-off'; readonly tracker: DeliveryTracker }
  | { readonly stage: 'queued'; readonly tracker: DeliveryTracker; readonly durableText: string }
  | { readonly stage: 'settled' }

export interface SteerLedgerEntry {
  readonly delivery: SteeringDelivery
  state: SteerLedgerState
}

/** A steer that was handled, failed, or refused is never handed back. */
export function settleSteer(entry: SteerLedgerEntry | undefined) {
  if (entry) entry.state = { stage: 'settled' }
}

/** Ended Runs' Undelivered steering messages, until Session Control settles them. */
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

/** The steer an ended Run would hand back, or nothing when Pi took it or it was settled. */
function undeliveredSteer(entry: SteerLedgerEntry): UndeliveredSteer | undefined {
  return (
    matchBy(entry.state, 'stage')
      .with('awaiting-handoff', () => ({ delivery: entry.delivery, handedOff: false }))
      // Still inside Pi run control: a promotion's Follow-up returns if its promotion is refused;
      // a direct steer is accepted or refused by its own late handoff, never handed back here.
      .with('handing-off', () => ({ delivery: entry.delivery, handedOff: false }))
      .with('queued', (state) =>
        // Pi started incorporating this message; handing it back would deliver it twice.
        deliveryCandidate(state.tracker, state.durableText)
          ? undefined
          : { delivery: entry.delivery, handedOff: true },
      )
      .with('settled', () => undefined)
      .exhaustive()
  )
}

/**
 * Whether one more direct steer may join this Run. Each direct steer the Run might hand back
 * becomes an extra Follow-up, so they are bounded to keep a returned queue within
 * `MAX_FOLLOW_UP_QUEUE_LISTED_ITEMS`.
 */
export function canAcceptReturnableSteer(ledger: readonly SteerLedgerEntry[]) {
  const returnable = ledger.filter(
    (entry) => entry.delivery.kind === 'steer' && undeliveredSteer(entry) !== undefined,
  ).length
  return returnable < MAX_RETURNED_STEER_OVERFLOW
}

export function retainUndeliveredSteers(runId: string, ledger: readonly SteerLedgerEntry[]) {
  const undelivered = ledger.flatMap((entry) => {
    const steer = undeliveredSteer(entry)
    return steer ? [steer] : []
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

/** The steers an ended Run never started incorporating. They stay until `forget`. */
export function readUndeliveredPiSteers(runId: string): readonly UndeliveredSteer[] {
  return undeliveredSteersByRun.get(runId) ?? []
}

/** Drop an ended Run's steers once Session Control durably settled them. */
export function forgetUndeliveredPiSteers(runId: string) {
  undeliveredSteersByRun.delete(runId)
}
