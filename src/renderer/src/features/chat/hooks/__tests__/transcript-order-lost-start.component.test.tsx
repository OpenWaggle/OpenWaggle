import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useOptimisticSteerStore } from '../../state/optimistic-steer-store'
import { useRunFinishingStore } from '../../state/run-finishing-store'
import { transcriptOrderChatStoreMock as chatStoreMock } from './transcript-order.ipc-mock'
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
    await h.startRun('run-1', 'host prompt run-1')
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
})
