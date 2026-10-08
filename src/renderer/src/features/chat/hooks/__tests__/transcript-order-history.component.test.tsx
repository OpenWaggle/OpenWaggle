import { afterEach, beforeEach, describe, it } from 'vitest'
import { expectCompleteTranscript } from './transcript-order.scenario'
import { cleanupTranscriptOrder, resetTranscriptOrderState } from './transcript-order.test-harness'

/*
 * The transcript shows a Session's whole history, above its compaction markers too (ADR 0048), so
 * the persisted transcript holds old "continue" / "ok" / "Done." rows. A send or a settled Run's
 * answer matched by text must not take one of those for its saved copy.
 */
describe('transcript order over compacted history with repeated texts', () => {
  beforeEach(resetTranscriptOrderState)
  afterEach(cleanupTranscriptOrder)

  it('shows a repeated send and its answer through a late settlement', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.seedHistory(),
      (h) => h.send('continue', 'run-1'),
      (h) => h.answer('Done.'),
      (h) => h.endRun({ settleLater: true, refetchLater: true }),
      (h) => h.send('continue', 'run-2'),
      (h) => h.answer('ok'),
      (h) => h.settleRun(),
      (h) => h.refreshDetail(),
      (h) => h.endRun(),
    ])
  })

  it('shows a repeated send queued as a Follow-up of a Run ending', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.seedHistory(),
      (h) => h.send('continue', 'run-1'),
      (h) => h.answer('Done.'),
      (h) => h.endRun({ continues: 'run-2', followUp: 'continue' }),
      (h) => h.answer('ok'),
      (h) => h.refreshDetail({ touched: true }),
      (h) => h.endRun(),
    ])
  })

  it('shows a settled Run of repeated texts across a stall', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.seedHistory(),
      (h) => h.send('continue', 'run-1'),
      (h) => h.answer('Done.'),
      (h) => h.stall(),
      (h) => h.endRun(),
      (h) => h.startRun('run-2', 'continue'),
      (h) => h.answer('ok'),
      (h) => h.resume(),
      (h) => h.endRun(),
    ])
  })

  it('shows a background Run of repeated texts opened after it settled', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('other'),
      (h) => h.seedHistory(),
      (h) => h.startRun('run-1', 'continue'),
      (h) => h.answer('Done.'),
      (h) => h.endRun({ continues: 'run-2', followUp: 'ok' }),
      (h) => h.answer('ok'),
      (h) => h.view('session'),
      (h) => h.endRun(),
    ])
  })

  it('shows a settled Run of repeated texts when the Session is opened from a stale detail', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.seedHistory(),
      (h) => h.send('continue', 'run-1'),
      (h) => h.answer('Done.'),
      (h) => h.endRun({ continues: 'run-2', followUp: 'ok' }),
      (h) => h.answer('working'),
      (h) => h.view('other'),
      (h) => h.view('session', { stale: true }),
      (h) => h.answer('more'),
      (h) => h.endRun(),
    ])
  })

  it('shows a settled Run whose answers alone it kept, opened from a stale detail', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('other'),
      (h) => h.seedHistory(),
      (h) => h.view('session'),
      (h) => h.view('other'),
      (h) => h.startRun('run-1', 'continue'),
      (h) => h.answer('Done.'),
      (h) => h.endRun({ continues: 'run-2', followUp: 'ok' }),
      (h) => h.answer('working'),
      (h) => h.view('session', { stale: true }),
      (h) => h.answer('more'),
      (h) => h.endRun(),
    ])
  })
})
