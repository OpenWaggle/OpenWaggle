import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initialModelState, MODEL_ACTIONS } from './transcript-order.model-actions'
import { assertTranscriptOrder, createScenarioHarness } from './transcript-order.scenario'
import { cleanupTranscriptOrder, resetTranscriptOrderState } from './transcript-order.test-harness'

/*
 * A Run whose start was lost streams over the rows of the Run before, which ended unsettled. Until
 * the Host names it, those rows stay (`noticedMessageIds`); when the Run before was saved, the
 * chat hydrated on the notice must show its answers once, even when no live prompt of that Run
 * started their span (it streamed in a stall, or before a reload).
 */

/** A model run replayed by action names; `lost:` loses the start of the action's Run. */
async function replayWithLostStarts(viewing: 'session' | 'other', names: readonly string[]) {
  const harness = createScenarioHarness()
  const state = initialModelState(viewing)
  await harness.mount(viewing)
  const trace: string[] = []
  for (const [step, name] of names.entries()) {
    const lost = name.startsWith('lost:')
    const actionName = lost ? name.slice('lost:'.length) : name
    const action = MODEL_ACTIONS.find((candidate) => candidate.name === actionName)
    if (!action) throw new Error(`no model action ${actionName}`)
    if (lost) harness.loseNextStart()
    await action.run(harness, state)
    await harness.settle()
    assertTranscriptOrder(harness, `step ${String(step)} ${name}`, trace)
  }
  expect(harness.shownKeys()).toEqual(harness.truthKeys())
}

describe('transcript order when a lost start streams over the saved Run before', () => {
  beforeEach(resetTranscriptOrderState)
  afterEach(cleanupTranscriptOrder)

  it('shows the saved Run before once when its prompt streamed in a stall', async () => {
    await replayWithLostStarts('other', [
      'stall',
      'startRun',
      'resume',
      'answer',
      'endRunSettlingLate',
      'viewSession',
      'lost:startRun',
    ])
  })

  // Fuzz seed 40683, minimised: the Run before took a steer after its first answer, and its
  // continuation's start was lost too.
  it('shows the saved Run before once when it took a steer after its first answer', async () => {
    await replayWithLostStarts('other', [
      'stall',
      'startRun',
      'resume',
      'answer',
      'stall',
      'answerWithReasoning',
      'resume',
      'lost:continueRun',
      'endRunSettlingLate',
      'viewSession',
      'lost:startRun',
    ])
  })

  it('shows the saved Run before once when the renderer reloaded during it', async () => {
    await replayWithLostStarts('other', [
      'lost:startRun',
      'reloadRenderer',
      'answerWithReasoning',
      'lost:continueRun',
      'answerWithReasoning',
      'endRunSettlingLate',
      'viewSession',
      'lost:startRun',
    ])
  })
})
