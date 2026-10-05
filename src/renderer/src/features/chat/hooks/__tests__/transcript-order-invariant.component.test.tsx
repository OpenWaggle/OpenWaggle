import { afterEach, beforeEach, describe, it } from 'vitest'
import { expectCompleteTranscript, type ScenarioStep } from './transcript-order.scenario'
import { cleanupTranscriptOrder, resetTranscriptOrderState } from './transcript-order.test-harness'

/*
 * The placement bugs found against the transcript-order invariant (`transcript-order.scenario.ts`),
 * one scenario each; `transcript-order-model.component.test.tsx` explores their combinations. A
 * model run that fails prints its step trace: replay it here as a named scenario.
 */

/** A Run's tool turns with a steer Pi incorporated between two of them. */
const toolTurnsWithSteer: readonly ScenarioStep[] = [
  (h) => h.answer('reading logs', { tools: 2 }),
  (h) => h.answer('reading memory', { tools: 1 }),
  (h) => h.steer('third time it happened'),
  (h) => h.answer('looking at the screenshot', { tools: 1 }),
]

describe('transcript order', () => {
  beforeEach(resetTranscriptOrderState)
  afterEach(cleanupTranscriptOrder)

  it('keeps a steer below the tool turns it followed when the Session is reopened mid-Run', async () => {
    // v1.0.0-beta.7: the reconnect put the steer right after the first prompt (at the "Worktree
    // created" row), and the Run's earlier answers below the answer streaming then.
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.send('Diagnose the stall', 'run-1'),
      ...toolTurnsWithSteer,
      (h) => h.answer('writing the fix', { open: true }),
      (h) => h.view('other'),
      (h) => h.view('session'),
      (h) => h.refreshDetail({ touched: true }),
      (h) => h.endRun(),
      (h) => h.refreshDetail(),
    ])
  })

  it('keeps every message of a Worker opened mid-Run in order while its detail loads', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('other'),
      (h) => h.startRun('run-1', 'Fix the cache'),
      ...toolTurnsWithSteer,
      (h) => h.view('session', { cached: false }),
      (h) => h.refreshDetail({ touched: true }),
      (h) => h.endRun(),
      (h) => h.refreshDetail(),
    ])
  })

  it('places a steer the renderer missed in a stall after the answer it followed', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('other'),
      (h) => h.startRun('run-1', 'Fix the cache'),
      (h) => h.view('session'),
      (h) => h.answer('reading the store', { tools: 1 }),
      (h) => h.stall(),
      (h) => h.steer('use the new API'),
      // The resync's reconnect waits on the Host while the next answers stream in.
      (h) => h.holdReconnects(),
      (h) => h.resume(),
      (h) => h.answer('switching the API', { tools: 1 }),
      (h) => h.answer('testing', { open: true }),
      (h) => h.releaseReconnects(),
      (h) => h.endRun(),
      (h) => h.refreshDetail(),
    ])
  })

  it('places a missed steer after an earlier steer that followed the same answer', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('other'),
      (h) => h.startRun('run-1', 'Fix the cache'),
      (h) => h.view('session'),
      (h) => h.answer('reading the store', { tools: 1 }),
      (h) => h.steer('first steer'),
      (h) => h.stall(),
      (h) => h.steer('second steer'),
      (h) => h.holdReconnects(),
      (h) => h.resume(),
      (h) => h.answer('switching the API'),
      (h) => h.releaseReconnects(),
      (h) => h.endRun(),
      (h) => h.refreshDetail(),
    ])
  })

  it('recovers a steer a foreground Run missed in a stall', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.send('Fix the cache', 'run-1'),
      (h) => h.answer('reading the store', { tools: 1 }),
      (h) => h.stall(),
      (h) => h.steer('use the new API'),
      (h) => h.answer('switching the API', { tools: 1 }),
      (h) => h.resume(),
      (h) => h.answer('testing'),
      (h) => h.endRun({ continues: 'run-2', followUp: 'now add a test' }),
      (h) => h.answer('adding the test'),
      (h) => h.endRun(),
      (h) => h.refreshDetail(),
    ])
  })

  it('keeps a promoted steer delivered during a stall above the answer after it', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.send('Fix the cache', 'run-1'),
      (h) => h.answer('reading the store', { tools: 1, open: true }),
      (h) => h.promote('use the new API'),
      (h) => h.stall(),
      (h) => h.steer('use the new API'),
      (h) => h.resume(),
      (h) => h.answer('switching the API'),
      (h) => h.answerPromotion('use the new API'),
      (h) => h.endRun(),
      (h) => h.refreshDetail(),
    ])
  })

  it('places a prompt and steer missed in a stall above the answers that followed', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.send('Fix the cache', 'run-1'),
      (h) => h.answer('done'),
      (h) => h.endRun(),
      (h) => h.view('other'),
      (h) => h.stall(),
      (h) => h.startRun('run-2', 'Add a test'),
      (h) => h.steer('use vitest'),
      (h) => h.resume(),
      (h) => h.answer('adding the test', { tools: 1 }),
      (h) => h.answer('running it', { open: true }),
      (h) => h.view('session'),
      (h) => h.endRun(),
      (h) => h.refreshDetail(),
    ])
  })

  it('places a steer whose answer was lost in the same stall above the later answers', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('other'),
      (h) => h.startRun('run-1', 'Fix the cache'),
      (h) => h.answer('reading the store', { tools: 1 }),
      (h) => h.stall(),
      (h) => h.answer('reading the tests', { tools: 1 }),
      (h) => h.steer('use the new API'),
      (h) => h.resume(),
      (h) => h.answer('switching the API', { tools: 1 }),
      (h) => h.answer('testing', { open: true }),
      (h) => h.view('session'),
      (h) => h.endRun(),
      (h) => h.refreshDetail(),
    ])
  })

  it('places answers received between two stalls below the prompt and steer they missed', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('other'),
      (h) => h.stall(),
      (h) => h.startRun('run-1', 'Fix the cache'),
      (h) => h.steer('use the new API'),
      (h) => h.resume(),
      (h) => h.answer('switching the API', { tools: 1 }),
      (h) => h.stall(),
      (h) => h.answer('testing', { open: true }),
      (h) => h.resume(),
      (h) => h.view('session'),
      (h) => h.endRun(),
      (h) => h.refreshDetail(),
    ])
  })

  it('shows a queued Follow-up the Host went straight on to once, below the Run before it', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.send('Fix the cache', 'run-1'),
      (h) => h.answer('reading the store', { tools: 1 }),
      (h) => h.answer('done'),
      (h) => h.endRun({ continues: 'run-2', followUp: 'now add a test' }),
      (h) => h.view('other'),
      (h) => h.view('session'),
      (h) => h.answer('adding the test', { tools: 1 }),
      (h) => h.steer('use vitest'),
      (h) => h.answer('test added'),
      (h) => h.refreshDetail({ touched: true }),
      (h) => h.endRun(),
      (h) => h.refreshDetail(),
    ])
  })

  it('keeps a promoted steer last while it waits, through a reload of the Run before it', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.startRun('run-1', 'Fix the cache'),
      (h) => h.answer('reading the store', { tools: 2 }),
      (h) => h.compact(),
      (h) => h.endRun({ continues: 'run-2', followUp: 'now add a test' }),
      (h) => h.answer('adding the test', { tools: 1, open: true }),
      (h) => h.promote('use vitest'),
      (h) => h.refreshDetail({ touched: true }),
      (h) => h.view('other'),
      (h) => h.view('session'),
      (h) => h.steer('use vitest'),
      (h) => h.answerPromotion('use vitest'),
      (h) => h.answer('test added'),
      (h) => h.endRun(),
      (h) => h.refreshDetail(),
    ])
  })

  it('keeps order when a slow reconnect lands after its Run settled', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('other'),
      (h) => h.startRun('run-1', 'Fix the cache'),
      (h) => h.answer('reading the store', { open: true }),
      (h) => h.holdReconnects(),
      (h) => h.view('session'),
      (h) => h.view('other'),
      (h) => h.endRun(),
      (h) => h.view('session'),
      (h) => h.startRun('run-2', 'Add a test'),
      (h) => h.releaseReconnects(),
      (h) => h.answer('adding the test'),
      (h) => h.endRun(),
      (h) => h.refreshDetail(),
    ])
  })

  it('shows a settled Run once when the renderer reloaded before its prompt', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('other'),
      (h) => h.startRun('run-1', 'Fix the cache'),
      (h) => h.answer('reading the store', { tools: 1 }),
      (h) => h.reloadRenderer('other'),
      // A compaction seeds a snapshot for the Run whose start (and prompt) the reload lost.
      (h) => h.compact(),
      (h) => h.answer('done'),
      // Opened while the Host is slow: the Run settles before the reconnect finds its prompt.
      (h) => h.holdReconnects(),
      (h) => h.view('session'),
      (h) => h.endRun({ continues: 'run-2', followUp: 'now add a test' }),
      (h) => h.releaseReconnects(),
      (h) => h.answer('adding the test'),
      (h) => h.refreshDetail({ touched: true }),
      (h) => h.endRun(),
      (h) => h.refreshDetail(),
    ])
  })

  it('keeps steers in order across a renderer reload, a Host restart and a compaction', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.startRun('run-1', 'Fix the cache'),
      ...toolTurnsWithSteer,
      (h) => h.reloadRenderer('session'),
      (h) => h.answer('after the reload', { tools: 1 }),
      (h) => h.steer('second steer'),
      (h) => h.compact(),
      (h) => h.answer('after the compaction'),
      (h) => h.refreshDetail({ touched: true }),
      (h) => h.restartHost(),
      (h) => h.refreshDetail(),
      (h) => h.send('Continue', 'run-2'),
      (h) => h.answer('continuing'),
      (h) => h.endRun(),
      (h) => h.refreshDetail(),
    ])
  })

  // A stall that loses a Run's settlement and the next Run's start leaves the settled Run's rows
  // under stream ids beside their persisted copies until the active Run ends: nothing tells the
  // renderer which of them were persisted.
  it.todo('shows a Run settled during a stall once while the next Run streams')
})
