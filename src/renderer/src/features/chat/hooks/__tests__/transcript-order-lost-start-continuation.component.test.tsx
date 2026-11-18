import { afterEach, beforeEach, describe, it } from 'vitest'
import { transcriptOrderChatStoreMock as chatStoreMock } from './transcript-order.ipc-mock'
import { expectCompleteTranscript } from './transcript-order.scenario'
import { cleanupTranscriptOrder, resetTranscriptOrderState } from './transcript-order.test-harness'

/*
 * Pi continues a Run whose continuation's start was lost (an overflow compaction's recovery, a
 * steer queued as it finished, a truncated answer). Until the Host's buffer names the Run, the
 * renderer cannot tell it from another Run: the answers it already streamed stay its own, unsaved,
 * and neither the notice nor a late settlement of the Run before may take them for that Run's.
 */
/** Holds the next Session refresh, the one after a settlement, until the returned release. */
function holdNextRefresh() {
  let release = () => {}
  chatStoreMock.refreshSession.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      }),
  )
  return async () => {
    release()
    await Promise.resolve()
  }
}

describe('transcript order when a continuing Run loses its start', () => {
  beforeEach(resetTranscriptOrderState)
  afterEach(cleanupTranscriptOrder)

  // Pi continues the shown Run, its start lost: the Host's buffer names it that Run, and the late
  // settlement of the Run before must not take its unsaved answers for the settled Run's.
  it('keeps the answers of a shown Run continuing with its start lost when the Run before settles late', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.startRun('run-1', 'host prompt run-1'),
      (h) => h.endRun({ settleLater: true }),
      (h) => h.startRun('run-2', 'host prompt run-2'),
      (h) => h.loseNextStart(),
      (h) => h.continueRun(),
      (h) => h.dropHistory(),
      (h) => h.answer('two'),
      (h) => h.answer('three'),
      (h) => h.settleRun(),
      (h) => h.endRun(),
    ])
  })

  // Pi continues a Run, its start lost: the answers already streamed are still its own, unsaved,
  // until the Host names the Run; set apart as the Run before's, they dropped out of the chat.
  it('keeps the answers of a Run continuing with its start lost, viewed away and back', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.startRun('run-1', 'host prompt run-1'),
      (h) => h.answer('first'),
      (h) => h.endRun(),
      (h) => h.startRun('run-2', 'host prompt run-2'),
      (h) => h.dropHistory(),
      (h) => h.answer('two-a'),
      (h) => h.loseNextStart(),
      (h) => h.continueRun(),
      (h) => h.view('other'),
      (h) => h.answer('two-b'),
      (h) => h.view('session'),
      (h) => h.answer('two-c'),
      (h) => h.endRun(),
    ])
  })

  it('keeps the answers of a shown Run continuing with its start lost across a resync', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.startRun('run-1', 'host prompt run-1'),
      (h) => h.endRun(),
      (h) => h.startRun('run-2', 'host prompt run-2'),
      (h) => h.dropHistory(),
      (h) => h.answer('answer 1'),
      (h) => h.loseNextStart(),
      (h) => h.continueRun(),
      (h) => h.answerWithGap('answer 2 streamed word by word'),
      (h) => h.endRun(),
    ])
  })

  it('keeps the answers of a Run continuing with its start lost when the Run two back settles late', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.startRun('run-1', 'host prompt run-1'),
      (h) => h.endRun({ settleLater: true }),
      (h) => h.startRun('run-2', 'host prompt run-2'),
      (h) => h.dropHistory(),
      (h) => h.answer('answer 1'),
      (h) => h.loseNextStart(),
      (h) => h.continueRun(),
      (h) => h.answerWithGap('answer 2 streamed word by word'),
      (h) => h.settleRun(),
      (h) => h.endRun(),
    ])
  })

  it('keeps the answers a shown Run streamed before its lost continuation when the Run before settles late', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.startRun('run-1', 'host prompt run-1'),
      (h) => h.endRun({ settleLater: true }),
      (h) => h.startRun('run-2', 'host prompt run-2'),
      (h) => h.answer('one'),
      (h) => h.answer('two'),
      (h) => h.loseNextStart(),
      (h) => h.continueRun(),
      (h) => h.answer('three'),
      (h) => h.dropHistory(),
      (h) => h.settleRun(),
      (h) => h.endRun(),
    ])
  })

  // A requested Waggle streams and ends with its start lost, before the Host names it: its
  // notice must not outlive its settlement, or the next Run's start keeps that settlement's mark
  // and the settlement's refetch, still in flight, drops the next Run's snapshot.
  it('keeps the next Run when it starts during the refetch after a lost-start Run settled', async () => {
    let releaseRefresh = async () => {}
    await expectCompleteTranscript([
      (h) => h.mount('other'),
      (h) => h.startRun('run-1', 'host prompt run-1'),
      (h) => h.answer('a1'),
      (h) => {
        releaseRefresh = holdNextRefresh()
        h.loseNextStart()
      },
      (h) => h.endRunWithRequestedWaggle('w1'),
      (h) => h.startRun('run-2', 'host prompt run-2'),
      (h) => h.answer('b1'),
      (h) => h.dropHistory(),
      () => releaseRefresh(),
      (h) => h.answer('b2'),
      (h) => h.view('session'),
      (h) => h.endRun(),
    ])
  })
})
