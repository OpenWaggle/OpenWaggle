import {
  awaitingPromotion,
  canSettle,
  ended,
  idle,
  type ModelAction,
  type ModelState,
  nextRunId,
  nextText,
  repeatableText,
} from './transcript-order.model-state'
import type { TranscriptOrderHarness } from './transcript-order.test-harness'

/*
 * The model of what can happen to a Session, for seeded exploration of the transcript-order
 * invariant. Preconditions keep it to what the Host does: a steer waits for no event a Run cannot
 * send meanwhile, and a queued Follow-up does not start while a promoted steer waits. Stalls, held
 * Host reads and late settlements may span anything.
 */

export { initialModelState, type ModelState } from './transcript-order.model-state'

const RUN_ACTIONS: readonly ModelAction[] = [
  {
    name: 'send',
    // Also before the earlier Run's settlement reaches the renderer.
    enabled: (s) => !s.running && s.viewing === 'session' && !s.stalled && !s.holding,
    run: (h, s) => {
      s.running = true
      const runId = nextRunId(s)
      // Every few Runs repeat a prompt: matching by text must not merge two of them.
      return h.send(s.runs % 4 === 0 ? 'continue' : `prompt ${runId}`, runId)
    },
  },
  {
    name: 'startRun',
    enabled: (s) => !s.running,
    run: (h, s) => {
      s.running = true
      s.runUnseen = s.stalled
      const runId = nextRunId(s, s.runs % 3 === 2 ? 'waggle' : 'run')
      h.startRun(runId, s.runs % 5 === 0 ? 'continue' : `host prompt ${runId}`)
    },
  },
  { name: 'retry', enabled: (s) => s.running, run: (h) => h.retry() },
  // The Run's Host keeps user messages but no finished answers nor start times: an older Host.
  { name: 'olderHost', enabled: (s) => s.running, run: (h) => h.olderHost() },
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
    enabled: (s) => s.running && s.promotions.length === 0,
    run: (h, s) => h.steer(repeatableText(s, 'steer', 4, 'keep going')),
  },
  {
    name: 'promote',
    // Also while the stream stalls; up to three wait at once, and every few repeat a prompt text.
    enabled: (s) => s.running && s.promotions.length < 3 && s.viewing === 'session',
    run: (h, s) => {
      const text = repeatableText(s, 'promoted', 3, 'continue')
      s.promotions.push({ text, incorporated: false })
      h.promote(text)
    },
  },
  {
    name: 'deliverPromotion',
    enabled: (s) => s.running && awaitingPromotion(s),
    run: (h, s) => {
      // Pi takes promoted steers in the order they were promoted.
      const promotion = s.promotions.find((candidate) => !candidate.incorporated)
      if (!promotion) return
      promotion.incorporated = true
      h.steer(promotion.text)
    },
  },
  {
    name: 'answerPromotion',
    enabled: (s) => !s.stalled && s.promotions[0]?.incorporated === true,
    run: (h, s) => {
      const promotion = s.promotions.shift()
      if (promotion) h.answerPromotion(promotion.text)
    },
  },
  { name: 'compact', enabled: (s) => s.running, run: (h) => h.compact() },
  {
    // Before the first Run: the history the chat shows above its compaction marker.
    name: 'seedHistory',
    enabled: (s) => s.runs === 0 && !s.history && idle(s) && !s.stalled,
    run: (h, s) => {
      s.history = true
      return h.seedHistory()
    },
  },
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
      return h.endRun(s.runs % 4 === 1 ? { after: 'compaction' } : {})
    },
  },
  {
    name: 'stop',
    enabled: canSettle,
    run: (h, s) => {
      ended(s)
      return h.endRun({ stop: true, ...(s.runs % 3 === 1 ? { after: 'stoppedRetry' } : {}) })
    },
  },
  {
    name: 'endRunWithRequestedWaggle',
    enabled: (s) => canSettle(s) && !awaitingPromotion(s),
    run: (h, s) => {
      ended(s)
      return h.endRunWithRequestedWaggle(nextText(s, 'waggle answer'))
    },
  },
  {
    name: 'continueRun',
    // A promoted steer waiting through it is still Pi's to take: it may deliver it after.
    enabled: (s) => s.running,
    run: (h, s) => {
      const steer = s.texts % 2 === 0 ? nextText(s, 'steer') : undefined
      return h.continueRun({ compact: s.texts % 3 === 0, ...(steer ? { steer } : {}) })
    },
  },
  {
    name: 'failBeforeStart',
    enabled: (s) => idle(s) && !s.stalled,
    run: (h, s) => h.failBeforeStart(nextRunId(s)),
  },
  {
    name: 'endRunSettlingLate',
    enabled: (s) => canSettle(s) && !awaitingPromotion(s),
    run: (h, s) => {
      ended(s)
      s.settling = true
      return h.endRun({ settleLater: true, hostSettled: s.runs % 2 === 0 })
    },
  },
  {
    name: 'deliverSettlement',
    enabled: (s) => s.settling,
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
      const stale = variant === 1 && s.running && h.hasLastDetail()
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
      s.runUnseen = false
      // A settlement on its way when the stream stalled was lost; the resync relays it.
      s.settling = false
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
    name: 'serveHeldReads',
    enabled: (s) => s.holding,
    run: (h) => h.serveHeldReads(),
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
    enabled: (s) => !s.stalled && !s.holding && !s.settling && s.promotions.length === 0,
    run: (h, s) => h.reloadRenderer(s.viewing),
  },
  {
    name: 'restartHost',
    // A Host restart drops the settlements it had in flight; none is pending here.
    enabled: (s) => canSettle(s) && !s.holding && s.promotions.length === 0,
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
  for (const promotion of state.promotions) {
    if (!promotion.incorporated) harness.steer(promotion.text)
  }
  for (const promotion of state.promotions.splice(0)) harness.answerPromotion(promotion.text)
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
