import { afterEach, beforeEach, describe, it } from 'vitest'
import { expectCompleteTranscript } from './transcript-order.scenario'
import { cleanupTranscriptOrder, resetTranscriptOrderState } from './transcript-order.test-harness'

/*
 * A settled Run the renderer shows only assistant rows of (its prompt never reached it, or an
 * agent-requested Waggle's answers): no user row vouches for the saved copies of its answers, which
 * once showed twice beside them until the next refetch. Each step checks every row shows once.
 */
describe('transcript order of a settled Run shown only by its answers', () => {
  beforeEach(resetTranscriptOrderState)
  afterEach(cleanupTranscriptOrder)

  it('shows the answers of a Run whose prompt a stall lost once as it settles', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.dropRetainedUsers(),
      (h) => h.stall(),
      (h) => h.startRun('run-1', 'Fix the cache'),
      (h) => h.resume(),
      (h) => h.answer('reading the store', { tools: 1 }),
      (h) => h.answer('done'),
      (h) => h.endRun({ settleLater: true, refetchLater: true }),
      (h) => h.settleRun(),
      (h) => h.refreshDetail(),
      (h) => h.send('next', 'run-2'),
      (h) => h.answer('next answer'),
      (h) => h.endRun(),
    ])
  })

  it('shows the answers of a requested Waggle once while the next Run starts', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('other'),
      (h) => h.startRun('run-1', 'Fix the cache'),
      (h) => h.answer('reading the store'),
      (h) => h.view('session'),
      (h) => h.endRunWithRequestedWaggle('the Waggle answer'),
      (h) => h.view('other'),
      (h) => h.view('session'),
      (h) => h.startRun('run-2', 'next prompt'),
      (h) => h.answer('ok'),
      (h) => h.endRun(),
    ])
  })
})
