import { afterEach, beforeEach, describe, it } from 'vitest'
import { transcriptOrderChatStoreMock as chatStoreMock } from './transcript-order.ipc-mock'
import { expectCompleteTranscript } from './transcript-order.scenario'
import { cleanupTranscriptOrder, resetTranscriptOrderState } from './transcript-order.test-harness'

/*
 * The settlement of the Run before can reach the renderer after the next Run streamed (a slow
 * bridge, a writer successor). When that next Run's start was lost, the renderer knows it only
 * from what it streamed: the late settlement must settle the Run before, not the Session, nor take
 * the next Run's rows, streamed into the same snapshot, for the settled Run's.
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

describe('transcript order when the Run before settles late and the next start is lost', () => {
  beforeEach(resetTranscriptOrderState)
  afterEach(cleanupTranscriptOrder)

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

  // The Run before's snapshot, cleared once its refresh lands, must not take the next Run's answers.
  it('keeps a Run whose start never arrived streaming while the Run before refreshes', async () => {
    let releaseRefresh = async () => {}
    await expectCompleteTranscript([
      (h) => h.mount('other'),
      (h) => h.startRun('run-1', 'host prompt run-1'),
      (h) => h.answer('one'),
      () => {
        releaseRefresh = holdNextRefresh()
      },
      (h) => h.endRun(),
      (h) => h.loseNextStart(),
      (h) => h.startRun('run-2', 'host prompt run-2'),
      (h) => h.answer('two'),
      (h) => h.dropHistory(),
      () => releaseRefresh(),
      (h) => h.answer('three'),
      (h) => h.view('session'),
      (h) => h.endRun(),
    ])
  })

  // A Run whose start was lost ends without a terminal end (Stop in its retry delay): that end
  // still names it, so the next Run is another and the stopped Run's late settlement is earlier.
  it('keeps the next Run when a Run whose start never arrived was stopped retrying', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.loseNextStart(),
      (h) => h.startRun('run-1', 'host prompt run-1'),
      (h) => h.answer('one'),
      (h) => h.endRun({ stop: true, after: 'stoppedRetry', settleLater: true }),
      (h) => h.startRun('run-2', 'host prompt run-2'),
      (h) => h.answer('two'),
      (h) => h.settleRun(),
      (h) => h.answer('three'),
      (h) => h.endRun(),
    ])
  })

  // The Run before ended but its settlement is late: opened then, its answer shows once.
  it('shows the Run before once when a Run whose start never arrived is opened before it settles', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.startRun('run-1', 'host prompt run-1'),
      (h) => h.answer('one'),
      (h) => h.endRun({ settleLater: true }),
      (h) => h.view('other'),
      (h) => h.loseNextStart(),
      (h) => h.startRun('run-2', 'host prompt run-2'),
      (h) => h.answer('two'),
      (h) => h.view('session'),
      (h) => h.settleRun(),
      (h) => h.answer('three'),
      (h) => h.endRun(),
    ])
  })

  // The late settlement of the Run before must not settle the next Run's rows, which streamed into
  // the same snapshot with no start between them, nor drop those its history then left out.
  it('keeps the answers of a Run whose start never arrived past a late settlement and its history', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('other'),
      (h) => h.startRun('run-1', 'host prompt run-1'),
      (h) => h.answer('one'),
      (h) => h.endRun({ settleLater: true }),
      (h) => h.loseNextStart(),
      (h) => h.startRun('run-2', 'host prompt run-2'),
      (h) => h.answer('two'),
      (h) => h.settleRun(),
      (h) => h.dropHistory(),
      (h) => h.answer('three'),
      (h) => h.view('session'),
      (h) => h.endRun(),
    ])
  })

  it('keeps the answers of a Run whose start never arrived, shown, then settled late away', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.startRun('run-1', 'host prompt run-1'),
      (h) => h.answer('one'),
      (h) => h.endRun({ settleLater: true }),
      (h) => h.loseNextStart(),
      (h) => h.startRun('run-2', 'host prompt run-2'),
      (h) => h.answer('two'),
      (h) => h.view('other'),
      (h) => h.settleRun(),
      (h) => h.dropHistory(),
      (h) => h.answer('three'),
      (h) => h.view('session'),
      (h) => h.endRun(),
    ])
  })

  // The Run before was known only from the bridge's announcement after a stall, its prompt in the
  // reconnect buffer, not the snapshot: its rows still go to their saved copies once it settles.
  it('shows the Run before once after a stall when the next start is lost and it settles late', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('other'),
      (h) => h.stall(),
      (h) => h.startRun('run-1', 'host prompt run-1'),
      (h) => h.answer('one'),
      (h) => h.resume(),
      (h) => h.answer('two'),
      (h) => h.endRun({ settleLater: true }),
      (h) => h.loseNextStart(),
      (h) => h.startRun('run-2', 'host prompt run-2'),
      (h) => h.answer('three'),
      (h) => h.settleRun(),
      (h) => h.answer('four'),
      (h) => h.view('session'),
      (h) => h.endRun(),
    ])
  })

  // The Run before started in a stall, its prompt in no snapshot to vouch for its rows: named
  // another Run, the lost-start Run drops them from its snapshot, as another Run's start does.
  it('shows the Run before once when a resync announced it and the next start is lost', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('other'),
      (h) => h.stall(),
      (h) => h.startRun('run-1', 'host prompt run-1'),
      (h) => h.resume(),
      (h) => h.answer('one'),
      (h) => h.endRun({ settleLater: true }),
      (h) => h.loseNextStart(),
      (h) => h.startRun('run-2', 'host prompt run-2'),
      (h) => h.view('session'),
      (h) => h.answer('two'),
      (h) => h.settleRun(),
      (h) => h.answer('three'),
      (h) => h.endRun(),
    ])
  })

  // Shown, then left: Pi retries the lost-start Run, its real start naming the route's unnamed one.
  it('keeps the answers its history dropped when a Run whose start was lost retries away', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.startRun('run-1', 'host prompt run-1'),
      (h) => h.endRun({ settleLater: true }),
      (h) => h.loseNextStart(),
      (h) => h.startRun('run-2', 'host prompt run-2'),
      (h) => h.dropHistory(),
      (h) => h.answer('one'),
      (h) => h.answer('two'),
      (h) => h.view('other'),
      (h) => h.retry(),
      (h) => h.view('session'),
      (h) => h.settleRun(),
      (h) => h.answer('three'),
      (h) => h.endRun(),
    ])
  })
})
