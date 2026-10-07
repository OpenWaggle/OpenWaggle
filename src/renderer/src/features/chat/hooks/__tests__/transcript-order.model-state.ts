import type { TranscriptOrderHarness } from './transcript-order.test-harness'

/** The state of the transcript-order model (`transcript-order.model-actions.ts`), and its helpers. */

export interface ModelState {
  running: boolean
  /** The Host settled a Run the renderer has not been told about yet. */
  settling: boolean
  viewing: 'session' | 'other'
  stalled: boolean
  /** The Run started in a stall: the renderer has not seen it start. */
  runUnseen: boolean
  holding: boolean
  /** The Session held saved, compacted history before its first Run. */
  history: boolean
  runs: number
  texts: number
  /** Promoted steers, in promotion order; several may wait, and with the same text. */
  promotions: Array<{ readonly text: string; incorporated: boolean }>
}

export interface ModelAction {
  readonly name: string
  readonly enabled: (state: ModelState) => boolean
  readonly run: (harness: TranscriptOrderHarness, state: ModelState) => unknown
}

export function initialModelState(viewing: ModelState['viewing']): ModelState {
  return {
    running: false,
    settling: false,
    viewing,
    stalled: false,
    runUnseen: false,
    holding: false,
    history: false,
    runs: 0,
    texts: 0,
    promotions: [],
  }
}

export function awaitingPromotion(state: ModelState) {
  return state.promotions.some((promotion) => !promotion.incorporated)
}

export function idle(state: ModelState) {
  return !state.running && !state.settling
}

/**
 * A Run's settlement cannot overtake an earlier one the renderer has not been told about. One
 * lost in a stall is relayed by the resync, except for a Run the renderer never saw start: no
 * bridge knows of it, and a steer promoted into it (the renderer shows the Session idle, so the
 * user could not) would wait forever.
 */
export function canSettle(state: ModelState) {
  const unseenWithPromotion = state.stalled && state.runUnseen && awaitingPromotion(state)
  return state.running && !state.settling && !unseenWithPromotion
}

export function nextText(state: ModelState, prefix: string) {
  state.texts += 1
  return `${prefix} ${String(state.texts)}`
}

/** Every few texts repeat one ("ok"): matching by content must not merge two such messages. */
export function repeatableText(state: ModelState, prefix: string, every: number, repeated: string) {
  const text = nextText(state, prefix)
  return state.texts % every === 0 ? repeated : text
}

export function nextRunId(state: ModelState, prefix = 'run') {
  state.runs += 1
  return `${prefix}-${String(state.runs)}`
}

/** A Run ended; a steer Pi never incorporated went back to the queue. */
export function ended(state: ModelState) {
  state.running = false
  state.promotions = state.promotions.filter((promotion) => promotion.incorporated)
}
