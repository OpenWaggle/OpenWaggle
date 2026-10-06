import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  finishModelRun,
  initialModelState,
  MODEL_ACTIONS,
  seededRandom,
} from './transcript-order.model-actions'
import { assertTranscriptOrder, createScenarioHarness } from './transcript-order.scenario'
import { cleanupTranscriptOrder, resetTranscriptOrderState } from './transcript-order.test-harness'

/*
 * Model-based exploration of the transcript-order invariant (`transcript-order.scenario.ts`):
 * each seed drives a random sequence of Runs, steers, promotions, queued Follow-ups, compactions,
 * Session switches, refetches, stalls, slow Host reads, renderer reloads and Host restarts through
 * the real chat hook, checking the invariant after every step and the complete Pi log at the end.
 * To explore further, set VITE_TRANSCRIPT_ORDER_SEEDS / _FIRST_SEED / _STEPS; a failing seed prints
 * its trace.
 */

const SEEDS = Number(import.meta.env.VITE_TRANSCRIPT_ORDER_SEEDS ?? 40)
const FIRST_SEED = Number(import.meta.env.VITE_TRANSCRIPT_ORDER_FIRST_SEED ?? 1)
const STEPS = Number(import.meta.env.VITE_TRANSCRIPT_ORDER_STEPS ?? 26)

type ModelAction = (typeof MODEL_ACTIONS)[number]

/** Runs `steps` model actions, `pick` choosing each among those enabled, checking every step. */
async function exploreRun(
  name: string,
  viewing: 'session' | 'other',
  steps: number,
  pick: (enabled: readonly ModelAction[], step: number) => ModelAction | undefined,
) {
  const harness = createScenarioHarness()
  const state = initialModelState(viewing)
  const trace: string[] = []
  await harness.mount(state.viewing)
  for (let step = 0; step < steps; step += 1) {
    const action = pick(
      MODEL_ACTIONS.filter((candidate) => candidate.enabled(state)),
      step,
    )
    if (!action) break
    await action.run(harness, state)
    await harness.settle()
    assertTranscriptOrder(harness, `${name} step ${String(step)} ${action.name}`, trace)
  }
  // Every Run ended and settled: the transcript must be the Pi log before any further refetch.
  await finishModelRun(harness, state, (label) => {
    assertTranscriptOrder(harness, `${name} ${label}`, trace)
    expect(harness.shownKeys(), trace.join('\n')).toEqual(harness.truthKeys())
  })
  assertTranscriptOrder(harness, `${name} final`, trace)
  expect(harness.shownKeys()).toEqual(harness.truthKeys())
}

async function exploreSeed(seed: number) {
  const random = seededRandom(seed)
  const viewing = random() < 0.5 ? 'session' : 'other'
  await exploreRun(`seed ${String(seed)}`, viewing, STEPS, (enabled) => {
    return enabled[Math.floor(random() * enabled.length)]
  })
}

/** A model run replayed by action names, as a failing seed printed it. */
async function replayRun(name: string, viewing: 'session' | 'other', names: readonly string[]) {
  await exploreRun(name, viewing, names.length, (enabled, step) => {
    const action = enabled.find((candidate) => candidate.name === names[step])
    if (!action)
      throw new Error(`${name}: ${String(names[step])} is not enabled at ${String(step)}`)
    return action
  })
}

/*
 * Seed 121097 at 45 steps, before promotions could repeat a prompt's text. A Run's prompt and steers
 * were lost in a stall and its answer streamed live, so only that answer is a settled row when the
 * Run goes on to a queued Follow-up: no settled user row of the Run vouches for its saved copy, and
 * the answer showed twice until the chain ended.
 */
const SEED_121097 = (
  'holdHostReads viewOther viewSession releaseReconnects holdHostReads stall startRun ' +
  'releaseReconnects compact holdHostReads answer steer releaseReconnects compact answer steer ' +
  'answer resume viewOther stop holdHostReads stall startRun steer retry resume viewSession ' +
  'answer touch refresh continues retry touch refresh steer continues retry steer releaseReconnects'
).split(' ')

/*
 * Seed 408 at 26 steps: a Run started while the earlier Run's settlement was still on its way, in
 * a snapshot a route wrote, and retried; the late settlement then took its rows for the earlier
 * Run's and the reload after it lost "answer 1".
 */
const SEED_408 = (
  'startRun retry viewSession compact endRunSettlingLate holdReconnects touch viewOther ' +
  'releaseReconnects touch holdReconnects viewSession startRun answer promote releaseReconnects ' +
  'compact viewOther answer viewSession retry refresh refresh promote deliverSettlement'
).split(' ')

/*
 * Seed 196 at 26 steps: before the earlier Run's settlement arrived, a resync rehydrated the next
 * Run from a detail holding the earlier one, which then showed under both ids.
 */
/*
 * Seed 5457 at 45 steps: a Run whose start was lost in a stall resumed under the bridge's unnamed
 * start, a route wrote its snapshot, and its retry (named) was taken for a new Run: the late
 * settlement of the Run before then took every row for that Run's and "answer 4" was lost.
 */
const SEED_5457 = (
  'send steer endRun stall startRun steer compact holdHostReads releaseReconnects compact promote ' +
  'resume compact refresh answer holdHostReads touch promote touch compact deliverPromotion retry ' +
  'touch promote answer refresh releaseReconnects'
).split(' ')

/*
 * Seed 5023 at 45 steps: a Run under an unnamed start ended with its settlement on its way, and the
 * next Run's start was taken for that Run's real one, so the ended Run's answers showed twice.
 */
const SEED_5023 = (
  'startRun answerWithGap retry compact answerWithGap retry restartHost touch compactManually ' +
  'compactManually reloadRenderer startRun reloadRenderer answerWithGap stop stall startRun steer ' +
  'promote compact deliverPromotion holdHostReads resume touch stall answer promote ' +
  'deliverPromotion compact compact compact retry retry resume answer answer refresh ' +
  'endRunSettlingLate viewOther answerPromotion startRun touch releaseReconnects viewSession'
).split(' ')

/*
 * Seed 170109 at 100 steps: a promoted steer Pi took during a stall, its Session not shown, ended
 * with its Run; that Run's settlement came after the next Run started, so its preview stayed and
 * sat below the next Run's prompt.
 */
const SEED_170109 = (
  'startRun holdHostReads compact steer releaseReconnects answer steer answer stop refresh ' +
  'refresh stall holdHostReads resume touch releaseReconnects holdHostReads stall startRun ' +
  'retry answer resume compact compact continues refresh retry releaseReconnects stop startRun ' +
  'viewSession viewOther refresh endRun holdReconnects stall startRun retry answer answer steer ' +
  'releaseReconnects retry holdHostReads steer compact retry answer compact releaseReconnects ' +
  'compact answer compact steer answer resume stop touch refresh reloadRenderer refresh ' +
  'compactManually viewSession touch holdHostReads refresh refresh compactManually refresh ' +
  'compactManually startRun retry promote refresh retry viewOther refresh touch stall retry ' +
  'compact releaseReconnects retry deliverPromotion answer compact resume answer holdReconnects ' +
  'endRunSettlingLate touch startRun viewSession'
).split(' ')

/*
 * Seed 210214 at 70 steps (minimised): two promoted steers say "continue"; the first was taken in a
 * stall, and the second one's row was credited to the first preview, out of promotion order.
 */
const SEED_210214 = (
  'startRun stall answer answer promote promote answer holdHostReads deliverPromotion resume ' +
  'promote answerPromotion deliverPromotion deliverPromotion'
).split(' ')

/*
 * Seed 200598 at 100 steps (minimised): the Session left while its Run went on to a queued
 * Follow-up with Host reads held; back on it, the Run ended with its settlement late and the next
 * Run started before the held reads were answered, and the first Run was missing until the end.
 */
const SEED_200598 = (
  'startRun answer steer steer steer answer steer viewOther holdHostReads steer continues ' +
  'viewSession endRunSettlingLate startRun releaseReconnects'
).split(' ')

/*
 * Seed 707 at 26 steps: a Run whose start was lost in a stall resumed under the bridge's unnamed
 * start and ended with its settlement late; the next Run started first, and the settlement, naming
 * an id the renderer never saw start, was taken for the Session settling and lost the next Run.
 */
const SEED_707 = (
  'holdHostReads releaseReconnects compactManually compactManually send restartHost viewOther ' +
  'stall resume touch failBeforeStart stall holdHostReads releaseReconnects startRun ' +
  'holdReconnects retry resume viewSession endRunSettlingLate startRun promote promote ' +
  'releaseReconnects deliverSettlement'
).split(' ')

/*
 * Seed 230320 at 45 steps: the renderer reloaded mid-Run, so it never saw that Run start; the Run
 * ended with its settlement late, the next Run started first, and the settlement was taken for the
 * Session settling and dropped the next Run's prompt.
 */
const SEED_230320 = (
  'startRun reloadRenderer answerWithGap answer touch answerWithGap endRunSettlingLate startRun ' +
  'holdReconnects deliverSettlement'
).split(' ')

/*
 * Seeds 263171 and 263241 at 70 steps: a Run the renderer knew only by the bridge's unnamed start
 * (it started during a stall, or the Host restarted) ended and Pi continued it under its own id;
 * that start was taken for another Run's, and the unnamed Run's answers were dropped as settled.
 */
const SEED_263171 = 'stall startRun resume answer answer continueRun viewSession'.split(' ')
const SEED_263241 =
  'viewSession startRun restartHost stall startRun resume answer continueRun answerWithGap'.split(
    ' ',
  )

/*
 * Review r7: the Host settled a Run sent from the route, clearing its buffer, before its
 * run-completed reached the renderer, so a held background reconnect found no buffer; the Run's
 * own prompt counted as settled from its start, and its answers showed twice.
 */
const HOST_SETTLED_FIRST = (
  'send answer endRun send answer viewOther holdHostReads viewSession answer endRunSettlingLate ' +
  'releaseReconnects deliverSettlement'
).split(' ')

const SEED_196 = (
  'touch holdReconnects touch viewSession startRun answer stall resume endRunSettlingLate ' +
  'startRun releaseReconnects answerWithGap'
).split(' ')

describe('transcript order, model-based', () => {
  beforeEach(resetTranscriptOrderState)
  afterEach(cleanupTranscriptOrder)

  it('shows a settled answer once when no settled user row of its Run vouches for it', async () => {
    await replayRun('seed 121097', 'session', SEED_121097)
  })

  it('keeps a retried Run out of the late settlement of the Run before it', async () => {
    await replayRun('seed 408', 'other', SEED_408)
  })

  it('leaves the Run before a pending settlement to its saved copy on a resync', async () => {
    await replayRun('seed 196', 'other', SEED_196)
  })

  it('keeps the retry of a Run that started unnamed as that Run', async () => {
    await replayRun('seed 5457', 'session', SEED_5457)
  })

  it('takes a start after an unnamed Run ended for another Run', async () => {
    await replayRun('seed 5023', 'session', SEED_5023)
  })

  it('keeps a Run started in a stall the same Run when Pi continues it', async () => {
    await replayRun('seed 263171', 'other', SEED_263171)
  })

  it('keeps a Run found at a Host reconnect the same Run when Pi continues it', async () => {
    await replayRun('seed 263241', 'other', SEED_263241)
  })

  it('keeps each answer once when a reconnect finds its Run settled at the Host', async () => {
    await replayRun('host settled first', 'session', HOST_SETTLED_FIRST)
  })

  it('takes a late settlement of the Run restored at reload for an earlier Run', async () => {
    await replayRun('seed 230320', 'session', SEED_230320)
  })

  it('takes a late settlement under an id never seen start for the Run started unnamed', async () => {
    await replayRun('seed 707', 'session', SEED_707)
  })

  it('credits a repeated steer text to the promotions in promotion order', async () => {
    await replayRun('seed 210214', 'session', SEED_210214)
  })

  it('keeps an earlier Run shown when the next Run starts before held reads land', async () => {
    await replayRun('seed 200598', 'session', SEED_200598)
  })

  it('drops a promoted steer preview when its Run ends, not only when it settles', async () => {
    await replayRun('seed 170109', 'other', SEED_170109)
  })

  for (let seed = FIRST_SEED; seed < FIRST_SEED + SEEDS; seed += 1) {
    it(`seed ${String(seed)}`, async () => {
      await exploreSeed(seed)
    })
  }
})
