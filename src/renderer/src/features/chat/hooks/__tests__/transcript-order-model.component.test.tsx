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

async function exploreSeed(seed: number) {
  const random = seededRandom(seed)
  const harness = createScenarioHarness()
  const state = initialModelState(random() < 0.5 ? 'session' : 'other')
  const trace: string[] = []
  await harness.mount(state.viewing)
  for (let step = 0; step < STEPS; step += 1) {
    const enabled = MODEL_ACTIONS.filter((action) => action.enabled(state))
    const action = enabled[Math.floor(random() * enabled.length)]
    if (!action) break
    await action.run(harness, state)
    await harness.settle()
    const label = `seed ${String(seed)} step ${String(step)} ${action.name}`
    // While a Host read is held the transcript shows hydration's placement; the reconnect must
    // leave it right, which the release step checks.
    if (state.holding) trace.push(`${label}: (reconnect in flight)`)
    else assertTranscriptOrder(harness, label, trace)
  }
  // Every Run ended and settled: the transcript must be the Pi log before any further refetch.
  await finishModelRun(harness, state, (label) => {
    assertTranscriptOrder(harness, `seed ${String(seed)} ${label}`, trace)
    expect(harness.shownKeys(), trace.join('\n')).toEqual(harness.truthKeys())
  })
  assertTranscriptOrder(harness, `seed ${String(seed)} final`, trace)
  expect(harness.shownKeys()).toEqual(harness.truthKeys())
}

describe('transcript order, model-based', () => {
  beforeEach(resetTranscriptOrderState)
  afterEach(cleanupTranscriptOrder)

  for (let seed = FIRST_SEED; seed < FIRST_SEED + SEEDS; seed += 1) {
    it(`seed ${String(seed)}`, async () => {
      await exploreSeed(seed)
    })
  }
})
