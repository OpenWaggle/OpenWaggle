import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { transcriptOrderApiMock as apiMock } from './transcript-order.ipc-mock'
import { missingMessages } from './transcript-order.knowledge'
import {
  createScenarioHarness,
  expectCompleteTranscript,
  type ScenarioStep,
} from './transcript-order.scenario'
import { cleanupTranscriptOrder, resetTranscriptOrderState } from './transcript-order.test-harness'

/*
 * Transcript order through Host races, delivery lag, and Run kinds: one named scenario per
 * reviewed bug, checked against the invariant in `transcript-order.scenario.ts`.
 */

/** A resync's reconnect: the Host reads the detail after the Run was saved, before it settled. */
const reconnectLandingBetweenEndAndSettlement: readonly ScenarioStep[] = [
  (h) => h.answer('reading the store', { tools: 1 }),
  (h) => h.holdReconnects({ onRelease: true }),
  (h) => h.stall(),
  (h) => h.resume(),
  (h) => h.answer('done'),
  (h) => h.endRun({ settleLater: true }),
  (h) => h.releaseReconnects(),
  (h) => h.settleRun(),
]

describe('transcript order through Host races', () => {
  beforeEach(resetTranscriptOrderState)
  afterEach(cleanupTranscriptOrder)

  it('shows a foreground Run once when a resync reconnect lands after the Run was saved', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.send('Fix the cache', 'run-1'),
      ...reconnectLandingBetweenEndAndSettlement,
    ])
  })

  it('shows a background Run once when a resync reconnect lands after the Run was saved', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('other'),
      (h) => h.startRun('run-1', 'Fix the cache'),
      (h) => h.view('session'),
      ...reconnectLandingBetweenEndAndSettlement,
    ])
  })

  it('shows a Run once when it is reopened after it was saved but before it settled', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('other'),
      (h) => h.startRun('run-1', 'Fix the cache'),
      (h) => h.view('session'),
      (h) => h.answer('reading the store', { tools: 1 }),
      (h) => h.answer('done'),
      (h) => h.endRun({ settleLater: true }),
      (h) => h.view('other'),
      (h) => h.view('session'),
      (h) => h.settleRun(),
    ])
  })

  it('shows a Run once when its slow reconnect lands after reopening loaded the saved Run', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.stall(),
      (h) => h.startRun('run-1', 'Fix the cache'),
      (h) => h.answer('reading the store', { tools: 1 }),
      (h) => h.holdReconnects(),
      (h) => h.resume(),
      (h) => h.view('other'),
      (h) => h.endRun({ settleLater: true }),
      (h) => h.view('session'),
      (h) => h.releaseReconnects(),
      (h) => h.settleRun(),
    ])
  })

  it('keeps a slow reconnect of a settled Run out of the next Run', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('other'),
      (h) => h.startRun('run-1', 'Fix the cache'),
      (h) => h.view('session'),
      (h) => h.answer('reading the store', { tools: 1 }),
      (h) => h.holdReconnects(),
      (h) => h.stall(),
      (h) => h.resume(),
      (h) => h.answer('done'),
      (h) => h.endRun(),
      (h) => h.startRun('run-2', 'Now the docs'),
      (h) => h.answer('writing the docs'),
      (h) => h.releaseReconnects(),
      (h) => h.endRun(),
    ])
  })

  it('keeps order when two overlapping resync reconnects land newest first', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('other'),
      (h) => h.startRun('run-1', 'Fix the cache'),
      (h) => h.view('session'),
      (h) => h.answer('reading the store', { tools: 1 }),
      (h) => h.holdReconnects(),
      (h) => h.stall(),
      (h) => h.steer('first steer'),
      (h) => h.resume(),
      (h) => h.answer('switching', { tools: 1 }),
      (h) => h.stall(),
      (h) => h.steer('second steer'),
      (h) => h.resume(),
      (h) => h.releaseReconnects({ newestFirst: true }),
      (h) => h.answer('done'),
      (h) => h.endRun(),
    ])
  })

  it('keeps the newer transcript when a send refresh of an earlier Run lands after it', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.send('Fix the cache', 'run-1'),
      (h) => h.answer('done'),
      (h) => h.holdReconnects(),
      (h) => h.endRun(),
      (h) => h.send('Now the docs', 'run-2'),
      (h) => h.answer('wrote the docs'),
      (h) => h.endRun(),
      (h) => h.releaseReconnects({ newestFirst: true }),
    ])
  })

  it('keeps a just-finished Run shown when a resync comes before its refetch', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('other'),
      (h) => h.startRun('run-1', 'Fix the cache'),
      (h) => h.view('session'),
      (h) => h.answer('reading the store', { tools: 1 }),
      (h) => h.steer('use the new API'),
      (h) => h.answer('done'),
      (h) => h.endRun({ refetchLater: true }),
      (h) => h.resync(),
      (h) => h.refreshDetail(),
    ])
  })
})

describe('transcript order under delivery lag', () => {
  beforeEach(resetTranscriptOrderState)
  afterEach(cleanupTranscriptOrder)

  it('keeps an answer whole after a stall lost the middle of its text', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.send('Fix the cache', 'run-1'),
      (h) => h.answerWithGap('reading the store word by word'),
      (h) => h.answer('done'),
      (h) => h.endRun(),
    ])
  })

  it('places a missed steer above later answers when events arrive half a second late', async () => {
    await expectCompleteTranscript(
      [
        (h) => h.mount('other'),
        (h) => h.startRun('run-1', 'Fix the cache'),
        (h) => h.view('session'),
        (h) => h.answer('reading the store', { tools: 1 }),
        (h) => h.stall(),
        (h) => h.answer('lost answer', { tools: 1 }),
        (h) => h.steer('use the new API'),
        (h) => h.holdReconnects(),
        (h) => h.resume(),
        (h) => h.answer('switching the API', { tools: 1 }),
        (h) => h.releaseReconnects(),
        (h) => h.endRun(),
      ],
      { lagMs: 500 },
    )
  })

  it('dates an answer a reconnect recovered by Host time, above a later missed steer', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('other'),
      (h) => h.startRun('run-1', 'Fix the cache'),
      (h) => h.view('session'),
      (h) => h.answer('reading the store', { tools: 1 }),
      (h) => h.stall(),
      (h) => h.answer('recovered answer', { tools: 1 }),
      (h) => h.resume(),
      (h) => h.stall(),
      (h) => h.answer('lost answer', { tools: 1 }),
      (h) => h.steer('use the new API'),
      (h) => h.answer('switching the API', { tools: 1 }),
      (h) => h.resume(),
      (h) => h.endRun(),
    ])
  })

  it('flags an answer the chat stopped showing', () => {
    const required = ['user:Fix the cache', 'assistant:reading the store', 'assistant:done']
    expect(missingMessages(['user:Fix the cache', 'assistant:done'], required)).toEqual([
      'missing: assistant:reading the store',
    ])
  })
})

describe('transcript order through Run kinds', () => {
  beforeEach(resetTranscriptOrderState)
  afterEach(cleanupTranscriptOrder)

  it('keeps order through an automatic retry, a Waggle Run, a Stop and a repeated prompt', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.send('continue', 'run-1'),
      (h) => h.answer('reading the store', { tools: 1 }),
      (h) => h.retry(),
      (h) => h.answer('done'),
      (h) => h.endRun(),
      (h) => h.send('continue', 'waggle-run-2'),
      (h) => h.answer('first agent', { tools: 1 }),
      (h) => h.answer('second agent'),
      (h) => h.endRun({ stop: true }),
      (h) => h.view('other'),
      (h) => h.startRun('run-3', 'continue'),
      (h) => h.answer('again'),
      (h) => h.view('session'),
      (h) => h.endRun(),
    ])
  })

  it('keeps a promoted steer last while new answers stream before Pi takes it', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.send('Fix the cache', 'run-1'),
      (h) => h.answer('reading the store', { tools: 1 }),
      (h) => h.promote('use the new API'),
      (h) => h.answer('still reading', { tools: 1 }),
      (h) => h.steer('use the new API'),
      (h) => h.answerPromotion('use the new API'),
      (h) => h.answer('done'),
      (h) => h.endRun(),
    ])
  })

  it('drops the preview of a steer the Run never took when its Session is not shown', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.send('Fix the cache', 'run-1'),
      (h) => h.answer('reading the store', { tools: 1 }),
      (h) => h.promote('use the new API'),
      (h) => h.view('other'),
      (h) => h.endRun(),
      (h) => h.startRun('run-2', 'next prompt'),
      (h) => h.view('session'),
      (h) => h.answer('done'),
      (h) => h.endRun(),
    ])
  })

  it('compacts an idle Session without reconnecting to a Run', async () => {
    const harness = createScenarioHarness()
    await harness.mount('session')
    await harness.send('Fix the cache', 'run-1')
    await harness.answer('done')
    await harness.endRun()
    await harness.settle()
    const reads = apiMock.getBackgroundRun.mock.calls.length
    await harness.compactManually()
    await harness.settle()
    expect(apiMock.getBackgroundRun.mock.calls.length).toBe(reads)
    expect(harness.shownKeys()).toEqual(harness.truthKeys())
  })
})

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
