import type { TranscriptOrderHarness } from './transcript-order.test-harness'

/*
 * The model of what can happen to a Session, for seeded exploration of the transcript-order
 * invariant. Preconditions keep it to what the Host does: a steer waits for no event a Run cannot
 * send meanwhile, a queued Follow-up does not start while a promoted steer waits, and a stall never
 * spans a Run's settlement (the `it.todo` in `transcript-order-invariant.component.test.tsx`).
 * Held Host reads and late settlements may span anything.
 */

export interface ModelState {
  running: boolean
  /** The Host settled a Run the renderer has not been told about yet. */
  settling: boolean
  viewing: 'session' | 'other'
  stalled: boolean
  holding: boolean
  runs: number
  texts: number
  promoted: string | null
  promotionIncorporated: boolean
}

interface ModelAction {
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
    promoted: null,
    promotionIncorporated: false,
  }
}

function awaitingPromotion(state: ModelState) {
  return state.promoted !== null && !state.promotionIncorporated
}

function idle(state: ModelState) {
  return !state.running && !state.settling
}

function canSettle(state: ModelState) {
  return state.running && !state.stalled
}

function nextText(state: ModelState, prefix: string) {
  state.texts += 1
  return `${prefix} ${String(state.texts)}`
}

/**
 * Every few answers say just "ok", and every few steers repeat one: within a Run and across Runs,
 * matching by content must not merge two messages with the same text.
 */
function repeatableText(state: ModelState, prefix: string, every: number, repeated: string) {
  const text = nextText(state, prefix)
  return state.texts % every === 0 ? repeated : text
}

function nextRunId(state: ModelState, prefix = 'run') {
  state.runs += 1
  return `${prefix}-${String(state.runs)}`
}

/** A Run ended; a steer Pi never incorporated went back to the queue. */
function ended(state: ModelState) {
  state.running = false
  if (awaitingPromotion(state)) state.promoted = null
}

const RUN_ACTIONS: readonly ModelAction[] = [
  {
    name: 'send',
    enabled: (s) => idle(s) && s.viewing === 'session' && !s.stalled && !s.holding,
    run: (h, s) => {
      s.running = true
      const runId = nextRunId(s)
      // Every few Runs repeat a prompt: matching by text must not merge two of them.
      return h.send(s.runs % 4 === 0 ? 'continue' : `prompt ${runId}`, runId)
    },
  },
  {
    name: 'startRun',
    enabled: idle,
    run: (h, s) => {
      s.running = true
      const runId = nextRunId(s, s.runs % 3 === 2 ? 'waggle' : 'run')
      h.startRun(runId, s.runs % 5 === 0 ? 'continue' : `host prompt ${runId}`)
    },
  },
  { name: 'retry', enabled: (s) => s.running, run: (h) => h.retry() },
  {
    name: 'answer',
    enabled: (s) => s.running,
    run: (h, s) => {
      const text = repeatableText(s, 'answer', 3, 'ok')
      return h.answer(text, { tools: text === 'ok' ? 0 : s.texts % 3 })
    },
  },
  {
    name: 'answerWithGap',
    // Only the Session shown reconnects on the resync, while the answer still streams; an unseen
    // Session's answer keeps the words it lost until its Run ends.
    enabled: (s) => s.running && s.viewing === 'session' && !s.stalled && !s.holding,
    run: (h, s) => h.answerWithGap(`${nextText(s, 'answer')} streamed word by word`),
  },
  {
    name: 'steer',
    enabled: (s) => s.running && s.promoted === null,
    run: (h, s) => h.steer(repeatableText(s, 'steer', 4, 'keep going')),
  },
  {
    name: 'promote',
    enabled: (s) => s.running && s.promoted === null && s.viewing === 'session' && !s.stalled,
    run: (h, s) => {
      s.promoted = nextText(s, 'promoted')
      s.promotionIncorporated = false
      h.promote(s.promoted)
    },
  },
  {
    name: 'deliverPromotion',
    enabled: (s) => s.running && awaitingPromotion(s),
    run: (h, s) => {
      s.promotionIncorporated = true
      h.steer(s.promoted ?? '')
    },
  },
  {
    name: 'answerPromotion',
    enabled: (s) => !s.stalled && s.promoted !== null && s.promotionIncorporated,
    run: (h, s) => {
      const text = s.promoted ?? ''
      s.promoted = null
      h.answerPromotion(text)
    },
  },
  { name: 'compact', enabled: (s) => s.running, run: (h) => h.compact() },
  {
    name: 'compactManually',
    enabled: (s) => idle(s) && !s.stalled,
    run: (h) => h.compactManually(),
  },
  {
    name: 'endRun',
    enabled: (s) => canSettle(s) && !awaitingPromotion(s),
    run: (h, s) => {
      ended(s)
      return h.endRun()
    },
  },
  {
    name: 'stop',
    enabled: canSettle,
    run: (h, s) => {
      ended(s)
      return h.endRun({ stop: true })
    },
  },
  {
    name: 'endRunSettlingLate',
    enabled: (s) => canSettle(s) && !awaitingPromotion(s),
    run: (h, s) => {
      ended(s)
      s.settling = true
      return h.endRun({ settleLater: true })
    },
  },
  {
    name: 'deliverSettlement',
    enabled: (s) => s.settling && !s.stalled,
    run: (h, s) => {
      s.settling = false
      return h.settleRun()
    },
  },
  {
    name: 'continues',
    enabled: (s) => canSettle(s) && !awaitingPromotion(s),
    run: (h, s) => {
      const runId = nextRunId(s)
      const refetchLater = s.runs % 2 === 0
      return h.endRun({ continues: runId, followUp: `follow up ${runId}`, refetchLater })
    },
  },
]

const DISTURBANCES: readonly ModelAction[] = [
  {
    name: 'viewOther',
    enabled: (s) => !s.stalled && s.viewing === 'session',
    run: (h, s) => {
      s.viewing = 'other'
      return h.view('other')
    },
  },
  {
    name: 'viewSession',
    enabled: (s) => !s.stalled && s.viewing === 'other',
    run: (h, s) => {
      s.viewing = 'session'
      // Cached, still loading, or, mid-Run, the chat store's detail from before its last refetch.
      const variant = s.texts % 3
      const stale = variant === 1 && s.running
      return h.view('session', variant === 0 ? { cached: false } : { stale })
    },
  },
  { name: 'refresh', enabled: (s) => !s.stalled, run: (h) => h.refreshDetail() },
  {
    name: 'touch',
    enabled: (s) => !s.stalled,
    run: (h) => h.refreshDetail({ touched: true }),
  },
  {
    name: 'stall',
    enabled: (s) => !s.stalled && !s.settling,
    run: (h, s) => {
      s.stalled = true
      h.stall()
    },
  },
  {
    name: 'resume',
    enabled: (s) => s.stalled,
    run: (h, s) => {
      s.stalled = false
      return h.resume()
    },
  },
  {
    name: 'holdReconnects',
    enabled: (s) => !s.holding,
    run: (h, s) => {
      s.holding = true
      h.holdReconnects()
    },
  },
  {
    name: 'holdHostReads',
    enabled: (s) => !s.holding,
    run: (h, s) => {
      s.holding = true
      h.holdReconnects({ onRelease: true })
    },
  },
  {
    name: 'releaseReconnects',
    enabled: (s) => s.holding,
    run: (h, s) => {
      s.holding = false
      return h.releaseReconnects()
    },
  },
  {
    name: 'reloadRenderer',
    enabled: (s) => !s.stalled && !s.holding && !s.settling && s.promoted === null,
    run: (h, s) => h.reloadRenderer(s.viewing),
  },
  {
    name: 'restartHost',
    enabled: (s) => s.running && !s.stalled && !s.holding && s.promoted === null,
    run: (h, s) => {
      s.running = false
      return h.restartHost()
    },
  },
]

export const MODEL_ACTIONS: readonly ModelAction[] = [...RUN_ACTIONS, ...DISTURBANCES]

/**
 * Ends whatever is in progress and opens the Session, which then shows the Pi log exactly. The
 * invariant is checked (`check`) before the last refetch too, so a refetch cannot mask a loss.
 */
export async function finishModelRun(
  harness: TranscriptOrderHarness,
  state: ModelState,
  check: (label: string) => void,
) {
  if (state.stalled) await harness.resume()
  if (state.holding) await harness.releaseReconnects()
  if (state.settling) await harness.settleRun()
  if (state.promoted !== null) {
    if (!state.promotionIncorporated) harness.steer(state.promoted)
    harness.answerPromotion(state.promoted)
  }
  if (state.running) await harness.endRun()
  if (state.viewing === 'other') await harness.view('session')
  check('ended')
  await harness.refreshDetail()
}

/** Deterministic PRNG (mulberry32), so a failing seed replays exactly. */
export function seededRandom(seed: number) {
  let value = seed >>> 0
  return () => {
    value = (value + 0x6d2b79f5) >>> 0
    let mixed = value
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}
