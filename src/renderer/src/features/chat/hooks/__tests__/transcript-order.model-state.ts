import type { TranscriptOrderHarness } from './transcript-order.test-harness'

/** The state of the transcript-order model (`transcript-order.model-actions.ts`), and its helpers. */

export interface ModelState {
  running: boolean
  /** The Host settled a Run the renderer has not been told about yet. */
  settling: boolean
  viewing: 'session' | 'other'
  stalled: boolean
  holding: boolean
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
    holding: false,
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

/** A Run's settlement cannot overtake an earlier one the renderer has not been told about. */
export function canSettle(state: ModelState) {
  return state.running && !state.stalled && !state.settling
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
