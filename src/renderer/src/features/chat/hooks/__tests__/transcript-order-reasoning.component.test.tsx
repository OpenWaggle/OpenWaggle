import { afterEach, beforeEach, describe, it } from 'vitest'
import { expectCompleteTranscript } from './transcript-order.scenario'
import { cleanupTranscriptOrder, resetTranscriptOrderState } from './transcript-order.test-harness'

/*
 * Answers with reasoning and two text segments, the later contained in the earlier
 * (`answerSegments`). The Host buffer keeps a Run's finished answers with their reasoning but not
 * the content index the renderer's thinking steps are named by; a reconnect must merge each
 * thought and segment with its own, not show a thought twice or lose a segment.
 */
describe('transcript order of answers with reasoning', () => {
  beforeEach(resetTranscriptOrderState)
  afterEach(cleanupTranscriptOrder)

  it('shows a finished answer once after switching Session and back mid-Run', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.send('Fix the cache', 'run-1'),
      (h) => h.answer('reading the store', { reasoning: true, tools: 1 }),
      (h) => h.answer('writing the fix', { reasoning: true, open: true }),
      (h) => h.view('other'),
      (h) => h.view('session'),
      (h) => h.answer('done'),
      (h) => h.endRun(),
    ])
  })

  it('shows them once after a stall and resync of the foreground Run', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.send('Fix the cache', 'run-1'),
      (h) => h.answer('reading the store', { reasoning: true }),
      (h) => h.stall(),
      (h) => h.answer('second pass', { reasoning: true }),
      (h) => h.resume(),
      (h) => h.answer('done', { reasoning: true }),
      (h) => h.endRun(),
    ])
  })

  // A stall loses the middle of an answer: the thought or tool call between its two text segments.
  for (const shape of ['reasoning', 'emptyThought', 'toolBetween'] as const) {
    it(`keeps the segments of a ${shape} answer whose middle a stall lost`, async () => {
      await expectCompleteTranscript([
        (h) => h.mount('session'),
        (h) => h.send('Fix the cache', 'run-1'),
        (h) => h.answerWithGap('reading the store', { shape }),
        // The middle lost again, and the answer's last words stream before the resync read lands.
        (h) => h.holdReconnects(),
        (h) => h.answerWithGap('writing the fix', { shape, holdLast: 1 }),
        (h) => h.releaseReconnects(),
        (h) => h.answer('done', { shape }),
        (h) => h.endRun(),
      ])
    })
  }

  it('shows the texts around an empty thought once after switching Session and back', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.send('Fix the cache', 'run-1'),
      (h) => h.answer('reading the store', { shape: 'emptyThought' }),
      (h) => h.answer('writing the fix', { shape: 'toolBetween', open: true }),
      (h) => h.view('other'),
      (h) => h.view('session'),
      (h) => h.answer('done', { shape: 'emptyThought' }),
      (h) => h.endRun(),
    ])
  })

  // A buffer whose history budget left out the Run's finished answers: the stream copies stand.
  for (const shape of ['reasoning', 'emptyThought', 'toolBetween'] as const) {
    it(`keeps a ${shape} answer a buffer kept no history of across a stall and a switch`, async () => {
      await expectCompleteTranscript([
        (h) => h.mount('session'),
        (h) => h.send('Fix the cache', 'run-1'),
        (h) => h.dropHistory(),
        (h) => h.answerWithGap('reading the store', { shape }),
        (h) => h.answer('writing the fix', { shape, open: true }),
        (h) => h.view('other'),
        (h) => h.view('session'),
        (h) => h.answer('done', { shape }),
        (h) => h.endRun(),
      ])
    })
  }
})
