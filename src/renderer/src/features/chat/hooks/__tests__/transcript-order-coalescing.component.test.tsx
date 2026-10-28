import { afterEach, beforeEach, describe, it } from 'vitest'
import { expectCompleteTranscript } from './transcript-order.scenario'
import { cleanupTranscriptOrder, resetTranscriptOrderState } from './transcript-order.test-harness'

/*
 * Transcript order with streamed deltas coalescing in the GUI main process
 * (`transcript-order.main-delivery.ts`). A reconnect reads the main process's stream buffer, which
 * already holds the deltas still waiting for their flush. Before the read flushed them (PR #391
 * review R2 P1-1), they reached the window after the snapshot that contained their text, and the
 * chat appended that text a second time.
 */

const COALESCED = { coalesceDeltas: true } as const

describe('transcript order while the main process coalesces deltas', () => {
  beforeEach(resetTranscriptOrderState)
  afterEach(cleanupTranscriptOrder)

  it('shows a background answer once when the Session is opened with its deltas held', async () => {
    await expectCompleteTranscript(
      [
        (h) => h.mount('other'),
        (h) => h.startRun('run-1', 'Fix the cache'),
        (h) => h.answer('reading the store', { tools: 1 }),
        (h) => h.answer('writing the fix', { open: true }),
        (h) => h.view('session'),
        (h) => h.flushDeltas(),
        (h) => h.endRun(),
      ],
      COALESCED,
    )
  })

  it('shows an answer once when the renderer reloads with its deltas held', async () => {
    await expectCompleteTranscript(
      [
        (h) => h.mount('other'),
        (h) => h.startRun('run-1', 'Fix the cache'),
        (h) => h.answer('writing the fix', { open: true }),
        (h) => h.reloadRenderer('session'),
        (h) => h.flushDeltas(),
        (h) => h.endRun(),
      ],
      COALESCED,
    )
  })

  it('shows a foreground answer once when a Host resync reads the buffer with its deltas held', async () => {
    await expectCompleteTranscript(
      [
        (h) => h.mount('session'),
        (h) => h.send('Fix the cache', 'run-1'),
        async (h) => {
          // The resync comes before the flush timer: the chat never saw the held deltas.
          h.answer('writing the fix', { open: true })
          await h.resync()
        },
        (h) => h.flushDeltas(),
        (h) => h.endRun(),
      ],
      COALESCED,
    )
  })
})
