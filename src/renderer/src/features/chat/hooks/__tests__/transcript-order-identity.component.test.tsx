import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { expectCompleteTranscript } from './transcript-order.scenario'
import type { TranscriptOrderHarness } from './transcript-order.test-harness'
import { cleanupTranscriptOrder, resetTranscriptOrderState } from './transcript-order.test-harness'

/*
 * Transcript order when what identifies a message is weak or missing: repeated texts, a buffer
 * that retains no user messages, a promoted steer whose row the transcript lost. One named
 * scenario per reviewed bug, checked against the invariant in `transcript-order.scenario.ts`.
 */

describe('transcript order with repeated texts', () => {
  beforeEach(resetTranscriptOrderState)
  afterEach(cleanupTranscriptOrder)

  it('keeps the next Run its own answer when it repeats the settled Run answer', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.send('Fix the cache', 'run-1'),
      (h) => h.answer('ok'),
      (h) => h.endRun({ continues: 'run-2', followUp: 'Now the docs', refetchLater: true }),
      (h) => h.answer('ok'),
      (h) => h.steer('use the new API'),
      (h) => h.answer('writing the docs', { open: true }),
      (h) => h.view('other'),
      // The chat store still holds the detail from before Run 1 was saved.
      (h) => h.view('session', { stale: true }),
      (h) => h.endRun(),
    ])
  })
})

describe('transcript order with a buffer that retains no user messages', () => {
  beforeEach(resetTranscriptOrderState)
  afterEach(cleanupTranscriptOrder)

  it('shows a Run once when its buffer lost its user messages and the Run was saved', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('other'),
      (h) => h.startRun('run-1', 'Fix the cache'),
      (h) => h.view('session'),
      (h) => h.answer('reading the store', { tools: 1 }),
      (h) => h.holdReconnects({ onRelease: true }),
      (h) => h.stall(),
      (h) => h.resume(),
      (h) => h.answer('done'),
      // A user message over the buffer's size cap.
      (h) => h.dropRetainedUsers(),
      (h) => h.endRun({ settleLater: true }),
      (h) => h.releaseReconnects(),
      (h) => h.settleRun(),
    ])
  })
})

describe('transcript order of a promoted steer the transcript lost', () => {
  beforeEach(resetTranscriptOrderState)
  afterEach(cleanupTranscriptOrder)

  it('keeps an incorporated steer preview above the answer after it', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('other'),
      (h) => h.startRun('run-1', 'Fix the cache'),
      // The chat store never loaded this Session: its detail is still on its way.
      (h) => h.view('session', { stale: true }),
      (h) => h.answer('reading the store', { tools: 1 }),
      (h) => h.promote('use the new API'),
      (h) => h.steer('use the new API'),
      (h) => h.retry(),
      (h) => h.answer('ok'),
      (h) => h.answerPromotion('use the new API'),
      (h) => h.endRun(),
    ])
  })

  it('keeps a steer preview above the next answer while the reconnect after a stall is read', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('other'),
      (h) => h.startRun('run-1', 'Fix the cache'),
      (h) => h.view('session'),
      (h) => h.answer('reading the store', { tools: 1 }),
      (h) => h.promote('use the new API'),
      (h) => h.stall(),
      (h) => h.steer('use the new API'),
      (h) => h.holdReconnects(),
      (h) => h.resume(),
      (h) => h.answer('ok'),
      (h) => h.releaseReconnects(),
      (h) => h.answerPromotion('use the new API'),
      (h) => h.endRun(),
    ])
  })

  it('keeps a promoted steer with the prompt text last until Pi takes it', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.stall(),
      (h) => h.send('continue', 'run-1'),
      (h) => h.answer('first answer'),
      (h) => h.promote('continue'),
      (h) => h.resume(),
      (h) => h.answer('second answer'),
      (h) => h.steer('continue'),
      (h) => h.answerPromotion('continue'),
      (h) => h.answer('done'),
      (h) => h.endRun(),
    ])
  })
})

describe('transcript order when a settlement arrives after the next Run started', () => {
  beforeEach(resetTranscriptOrderState)
  afterEach(cleanupTranscriptOrder)

  for (const prompt of ['Now the docs', 'continue']) {
    it(`keeps the next Run's prompt "${prompt}" and answers across a reopen`, async () => {
      await expectCompleteTranscript([
        (h) => h.mount('session'),
        (h) => h.send('continue', 'run-1'),
        (h) => h.answer('ok'),
        (h) => h.endRun({ settleLater: true }),
        (h) => h.send(prompt, 'run-2'),
        (h) => h.settleRun(),
        (h) => h.answer('writing'),
        (h) => h.view('other'),
        (h) => h.view('session'),
        (h) => h.answer('more'),
        (h) => h.endRun(),
      ])
    })
  }

  it('keeps a retried next Run whose snapshot a route wrote out of the late settlement', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.startRun('run-1', 'Fix the cache'),
      (h) => h.answer('reading the store'),
      (h) => h.endRun({ settleLater: true }),
      (h) => h.startRun('run-2', 'Now the docs'),
      (h) => h.answer('writing'),
      (h) => h.retry(),
      (h) => h.settleRun(),
      (h) => h.answer('more'),
      (h) => h.endRun(),
    ])
  })

  it('keeps repeated prompts and answers in order through late settlements and stale views', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.send('continue', 'run-1'),
      (h) => h.answer('ok'),
      (h) => h.endRun({ continues: 'run-2', followUp: 'continue', refetchLater: true }),
      (h) => h.answer('ok'),
      (h) => h.view('other'),
      (h) => h.view('session', { stale: true }),
      (h) => h.endRun({ continues: 'run-3', followUp: 'continue', settleLater: true }),
      (h) => h.holdReconnects(),
      (h) => h.view('other'),
      (h) => h.view('session', { stale: true }),
      (h) => h.settleRun(),
      (h) => h.answer('ok'),
      (h) => h.releaseReconnects(),
      (h) => h.endRun(),
    ])
  })

  it('keeps a promoted steer the Run never took shown until the Run settles', async () => {
    const stillShown = (h: TranscriptOrderHarness) =>
      expect(h.shownKeys()).toContain('user:use the new API')
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.startRun('run-1', 'Fix the cache'),
      (h) => h.answer('reading the store', { tools: 1 }),
      (h) => h.promote('use the new API'),
      (h) => h.endRun({ stop: true, settleLater: true }),
      // The Host puts the steer back in the queue only as the Run settles.
      stillShown,
      (h) => h.settleRun(),
    ])
  })

  // The Host settled the Run (clearing its buffer) before its run-completed reached the renderer,
  // so the reconnect's second buffer read finds none, and only its detail scopes the dedupe.
  it('keeps each answer once when a held reconnect finds its Run settled at the Host', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.send('first prompt', 'run-1'),
      (h) => h.answer('first answer'),
      (h) => h.endRun(),
      (h) => h.send('second prompt', 'run-2'),
      (h) => h.answer('second answer', { tools: 1 }),
      (h) => h.view('other'),
      (h) => h.holdReconnects({ onRelease: true }),
      (h) => h.view('session'),
      (h) => h.answer('third answer'),
      (h) => h.endRun({ settleLater: true, hostSettled: true }),
      (h) => h.releaseReconnects(),
      (h) => h.settleRun(),
      (h) => h.refreshDetail(),
      (h) => h.view('other'),
      (h) => h.view('session'),
    ])
  })

  // A reconnect read the buffer of Run A, then the Host served its detail after A ended and before
  // Run B started; B answered the same text live and settled at the Host before that answer
  // landed. B's live answer is not the saved answer of A's.
  for (const aPromptShown of [false, true]) {
    it(`keeps a later Run's answer repeating a saved one (A's prompt shown: ${String(aPromptShown)})`, async () => {
      await expectCompleteTranscript([
        (h) => h.mount('session'),
        (h) => (aPromptShown ? h.startRun('run-1', 'prompt A') : undefined),
        (h) => h.stall(),
        (h) => (aPromptShown ? undefined : h.startRun('run-1', 'prompt A')),
        (h) => h.answer('ok'),
        (h) => h.holdReconnects({ onRelease: true }),
        (h) => h.resume(),
        (h) => h.endRun({ settleLater: true, hostSettled: true }),
        (h) => h.serveHeldReads(),
        (h) => h.startRun('run-2', 'prompt B'),
        (h) => h.answer('ok'),
        (h) => h.endRun({ settleLater: true, hostSettled: true }),
        (h) => h.releaseReconnects(),
        (h) => h.settleRun(),
        (h) => h.settleRun(),
      ])
    })
  }
})
