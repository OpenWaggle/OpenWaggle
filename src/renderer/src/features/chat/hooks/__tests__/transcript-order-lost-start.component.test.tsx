import { afterEach, beforeEach, describe, it } from 'vitest'
import { expectCompleteTranscript } from './transcript-order.scenario'
import { cleanupTranscriptOrder, resetTranscriptOrderState } from './transcript-order.test-harness'

/*
 * A Session another agent launched into a new worktree ran for two hours while its chat showed
 * nothing: the Run's `agent_start` never reached the renderer, which therefore hydrated the
 * Session as idle from a transcript the Run had not saved yet, and kept none of what it streamed.
 * The Run's own events now tell the renderer it is active, so the chat reconnects to its buffer.
 */
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

  // The settlement of the Run before reaches the renderer after the next Run streamed (a slow
  // bridge), with the next Run's start lost: it settles the earlier Run, not the Session.
  it('keeps a Run whose start never arrived when the Run before settles late', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.startRun('run-1', 'host prompt run-1'),
      (h) => h.answer('one'),
      (h) => h.endRun({ settleLater: true }),
      (h) => h.loseNextStart(),
      (h) => h.startRun('run-2', 'host prompt run-2'),
      (h) => h.answer('two'),
      (h) => h.settleRun(),
      (h) => h.answer('three'),
      (h) => h.endRun(),
    ])
  })

  it('keeps a background Run whose start never arrived when the Run before settles late', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.startRun('run-1', 'host prompt run-1'),
      (h) => h.answer('one'),
      (h) => h.endRun({ settleLater: true, refetchLater: true }),
      (h) => h.view('other'),
      (h) => h.loseNextStart(),
      (h) => h.startRun('run-2', 'host prompt run-2'),
      (h) => h.answer('two'),
      (h) => h.settleRun(),
      (h) => h.view('session'),
      (h) => h.answer('three'),
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

  // The Run before was restored at the renderer's start, its own start never seen.
  it('keeps a Run whose start never arrived when a Run restored at a reload settles late', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.startRun('run-1', 'host prompt run-1'),
      (h) => h.answer('one'),
      (h) => h.reloadRenderer('session'),
      (h) => h.answer('one more'),
      (h) => h.endRun({ settleLater: true }),
      (h) => h.loseNextStart(),
      (h) => h.startRun('run-2', 'host prompt run-2'),
      (h) => h.answer('two'),
      (h) => h.settleRun(),
      (h) => h.answer('three'),
      (h) => h.endRun(),
    ])
  })

  it('keeps a background Run whose start never arrived when a restored Run settles late', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('other'),
      (h) => h.startRun('run-1', 'host prompt run-1'),
      (h) => h.answer('one'),
      (h) => h.reloadRenderer('other'),
      (h) => h.endRun({ settleLater: true }),
      (h) => h.loseNextStart(),
      (h) => h.startRun('run-2', 'host prompt run-2'),
      (h) => h.answer('two'),
      (h) => h.settleRun(),
      (h) => h.view('session'),
      (h) => h.answer('three'),
      (h) => h.endRun(),
    ])
  })

  // The Host put the promoted steer the Run before never took back in the queue.
  it('drops the preview of a steer the Run before never took when the next start is lost', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.startRun('run-1', 'host prompt run-1'),
      (h) => h.answer('one'),
      (h) => h.promote('promoted later'),
      (h) => h.endRun({ settleLater: true }),
      (h) => h.loseNextStart(),
      (h) => h.startRun('run-2', 'host prompt run-2'),
      (h) => h.answer('two'),
      (h) => h.settleRun(),
      (h) => h.answer('three'),
      (h) => h.endRun(),
    ])
  })
})
