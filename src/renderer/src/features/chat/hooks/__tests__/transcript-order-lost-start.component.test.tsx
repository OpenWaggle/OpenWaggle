import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useOptimisticSteerStore } from '../../state/optimistic-steer-store'
import { useRunFinishingStore } from '../../state/run-finishing-store'
import { SESSION_ID } from './transcript-order.persisted'
import { createScenarioHarness, expectCompleteTranscript } from './transcript-order.scenario'
import { cleanupTranscriptOrder, resetTranscriptOrderState } from './transcript-order.test-harness'

/*
 * A Session another agent launched into a new worktree ran for two hours while its chat showed
 * nothing: the Run's `agent_start` never reached the renderer, which therefore hydrated the
 * Session as idle from a transcript the Run had not saved yet, and kept none of what it streamed.
 * The Run's own events now tell the renderer it is active, so the chat reconnects to its buffer.
 */
const steerPreviews = () => useOptimisticSteerStore.getState().previews.get(SESSION_ID)?.length ?? 0

describe('transcript order when the Run start is lost', () => {
  beforeEach(resetTranscriptOrderState)
  afterEach(cleanupTranscriptOrder)

  it('shows a background Run whose start never arrived when the Session is opened', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('other'),
      (h) => h.loseNextStart(),
      (h) => h.startRun('run-1', 'host prompt run-1'),
      (h) => h.answer('reading the store', { tools: 1 }),
      (h) => h.answer('editing the bridge', { tools: 2 }),
      (h) => h.view('session'),
      (h) => h.answer('done'),
      (h) => h.endRun(),
    ])
  })

  it('shows a Run whose start never arrived in the Session already open', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.loseNextStart(),
      (h) => h.startRun('run-1', 'host prompt run-1'),
      (h) => h.answer('reading the store', { tools: 1 }),
      (h) => h.answer('done'),
      (h) => h.endRun(),
    ])
  })

  it('shows a Run whose start never arrived after its history was left out', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('other'),
      (h) => h.loseNextStart(),
      (h) => h.startRun('run-1', 'host prompt run-1'),
      (h) => h.answer('reading the store', { tools: 1 }),
      (h) => h.dropHistory(),
      (h) => h.answer('editing the bridge'),
      (h) => h.view('session'),
      (h) => h.endRun(),
    ])
  })

  it('settles a Run that streamed again after its end lost its start', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.loseNextStart(),
      (h) => h.startRun('run-1', 'host prompt run-1'),
      (h) => h.answer('one'),
      (h) => h.endRun({ continues: 'run-2' }),
      (h) => h.answer('two'),
      (h) => h.endRun(),
    ])
  })

  // Pi continues the Run, its start lost, then retries it: another start under the same id with no
  // end between. The Run is listed once, or its settlement left the Session finishing.
  it('settles a Run whose lost continuation start a retry follows', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.startRun('run-1', 'host prompt run-1'),
      (h) => h.answer('one'),
      (h) => h.loseNextStart(),
      (h) => h.continueRun(),
      (h) => h.answer('two'),
      (h) => h.retry(),
      (h) => h.answer('three'),
      (h) => h.endRun(),
      () => expect(useRunFinishingStore.getState().ids.has(SESSION_ID)).toBe(false),
    ])
  })

  // The Host holds a steer the Run has not taken until the Run settles.
  it('keeps the preview of an untaken steer while the same Run continues, its start lost', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.startRun('run-1', 'host prompt run-1'),
      (h) => h.answer('one'),
      (h) => h.promote('promoted later'),
      (h) => h.loseNextStart(),
      (h) => h.continueRun(),
      (h) => h.answer('two'),
      () => expect(steerPreviews()).toBe(1),
      (h) => h.endRun(),
    ])
  })

  // Mid-Run only the render snapshot holds the answers the buffer's history budget dropped.
  it('keeps the answers of a background Run whose start never arrived past its history', async () => {
    const h = createScenarioHarness()
    await h.mount('other')
    h.loseNextStart()
    h.startRun('run-1', 'host prompt run-1')
    await h.settle()
    h.dropHistory()
    for (const text of ['one', 'two', 'three']) {
      await h.answer(text)
      await h.settle()
    }
    await h.view('session')
    await h.settle()

    expect(h.shownKeys()).toEqual([
      'user:host prompt run-1',
      'assistant:one',
      'assistant:two',
      'assistant:three',
    ])
  })

  // Opened after the Run's end, its continuation's start lost, before it streams again: the
  // Run's snapshot still holds the answers its history dropped.
  it('keeps the answers of a Run continuing with its start lost, opened before it streams again', async () => {
    const h = createScenarioHarness()
    await h.mount('other')
    h.startRun('run-1', 'host prompt run-1')
    await h.settle()
    for (const text of ['one', 'two']) {
      await h.answer(text)
      await h.settle()
    }
    h.dropHistory()
    await h.answer('three')
    await h.settle()
    h.loseNextStart()
    h.continueRun()
    await h.settle()
    await h.view('session')
    await h.settle()
    await h.answer('four')
    await h.settle()

    expect(h.shownKeys()).toEqual([
      'user:host prompt run-1',
      'assistant:one',
      'assistant:two',
      'assistant:three',
      'assistant:four',
    ])
  })
})
