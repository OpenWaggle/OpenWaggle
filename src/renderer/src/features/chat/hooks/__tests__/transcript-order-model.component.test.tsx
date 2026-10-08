import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  finishModelRun,
  initialModelState,
  MODEL_ACTIONS,
  seededRandom,
} from './transcript-order.model-actions'
import {
  HOST_SETTLED_FIRST,
  SEED_196,
  SEED_408,
  SEED_707,
  SEED_5023,
  SEED_5457,
  SEED_121097,
  SEED_170109,
  SEED_200598,
  SEED_210214,
  SEED_230320,
  SEED_263171,
  SEED_263241,
  SEED_320289,
  SEED_340281,
  SEED_350207,
  SEED_350207_FULL,
  SEED_370043,
  SEED_380015,
  SEED_392631,
  SEED_430033,
  SEED_430057,
  SEED_430218,
  SEED_455984,
  SEED_530421,
  SEED_531523,
  SEED_561547,
  SEED_562217,
  SEED_564032,
  SEED_582014,
} from './transcript-order.replays'
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

  it('leaves a Run that settled during a held reconnect read to its saved copy', async () => {
    await replayRun('seed 320289', 'other', SEED_320289)
  })

  it('places the first buffer user messages when the Run settled before the second read', async () => {
    await replayRun('seed 350207', 'session', SEED_350207)
  })

  it('places them before the answers the Run streamed after them', async () => {
    await replayRun('seed 350207 in full', 'session', SEED_350207_FULL)
  })

  it('reads the detail again when the next Run replaced the buffer during the read', async () => {
    await replayRun('seed 370043', 'session', SEED_370043)
  })

  it('names a Run started unnamed at its end, so the next Run clears its previews', async () => {
    await replayRun('seed 380015', 'session', SEED_380015)
  })

  it('scopes a reconnect by the buffer it read first when the Run settled meanwhile', async () => {
    await replayRun('seed 340281', 'other', SEED_340281)
  })

  it('leaves an active Run answer the detail saved to its saved copy after a stall', async () => {
    await replayRun('seed 392631', 'other', SEED_392631)
  })

  it('reads the transcript on a resync after the send Run handed off in a stall', async () => {
    await replayRun('seed 430033', 'session', SEED_430033)
  })

  it('reads the transcript on a resync after a continuation steer and hand-off', async () => {
    await replayRun('seed 430057', 'session', SEED_430057)
  })

  it('reads the transcript on a resync after a whole Run went by in a stall', async () => {
    await replayRun('seed 430218', 'other', SEED_430218)
  })

  it('dedupes the answer of a Run a stall hid the end of, before the next Run', async () => {
    await replayRun('seed 531523', 'other', SEED_531523)
  })

  it('dedupes the answer of a Run whose prompt a stall lost, with no buffer left', async () => {
    await replayRun('seed 530421', 'other', SEED_530421)
  })

  it('matches a reasoning answer with its saved copy however its text is split', async () => {
    await replayRun('seed 562217', 'session', SEED_562217)
  })

  it('matches a reasoning answer of a continued Run with its saved copy', async () => {
    await replayRun('seed 564032', 'session', SEED_564032)
  })

  it('drops the steer preview of a Run a stall hid when the resync finds the Session idle', async () => {
    await replayRun('seed 561547', 'other', SEED_561547)
  })

  it('drops the steer preview of a Run a stall hid once another Run starts', async () => {
    await replayRun('seed 582014', 'session', SEED_582014)
  })

  it('holds an earlier Run prompt the transcript holds at its log order', async () => {
    await replayRun('seed 455984', 'session', SEED_455984)
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
