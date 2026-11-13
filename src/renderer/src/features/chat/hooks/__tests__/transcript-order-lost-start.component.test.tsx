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
})
