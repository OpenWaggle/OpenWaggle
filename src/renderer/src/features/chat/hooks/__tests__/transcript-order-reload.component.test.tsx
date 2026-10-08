import { afterEach, beforeEach, describe, it } from 'vitest'
import { expectCompleteTranscript } from './transcript-order.scenario'
import { cleanupTranscriptOrder, resetTranscriptOrderState } from './transcript-order.test-harness'

/*
 * A renderer reload mid-Run: a Run's messages are persisted only when it ends, so its earlier
 * answers come from the Host stream buffer, which keeps the Run's finished messages. The invariant
 * requires every message of the active Run that buffer holds, reload or not.
 */
describe('transcript order across a renderer reload mid-Run', () => {
  beforeEach(resetTranscriptOrderState)
  afterEach(cleanupTranscriptOrder)

  it('keeps the earlier answers of a Run the renderer followed when it reloads', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.send('Fix the cache', 'run-1'),
      (h) => h.answer('reading the store', { tools: 1 }),
      (h) => h.steer('also the tests'),
      (h) => h.answer('second pass', { tools: 2 }),
      (h) => h.answer('third', { open: true }),
      (h) => h.reloadRenderer('session'),
      (h) => h.answer('after the reload'),
      (h) => h.endRun(),
    ])
  })

  it('keeps the earlier answers of a background Run opened after a reload', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('other'),
      (h) => h.startRun('run-1', 'Fix the cache'),
      (h) => h.answer('reading the store', { tools: 1 }),
      (h) => h.steer('also the tests'),
      (h) => h.answer('second pass'),
      (h) => h.reloadRenderer('other'),
      (h) => h.view('session'),
      (h) => h.answer('after the reload'),
      (h) => h.endRun(),
    ])
  })

  it('keeps them through a reload after a compaction and before a Follow-up', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.startRun('run-1', 'Fix the cache'),
      (h) => h.answer('reading the store', { tools: 1 }),
      (h) => h.compact(),
      (h) => h.answer('ok'),
      (h) => h.reloadRenderer('session'),
      (h) => h.answer('ok'),
      (h) => h.endRun({ continues: 'run-2', followUp: 'now add a test' }),
      (h) => h.answer('adding the test'),
      (h) => h.endRun(),
    ])
  })

  // A buffer whose history budget left out the Run's finished answers: the reload shows the
  // prompt, the steers and the streaming answer, and the earlier answers return with the Run's
  // persisted messages.
  it('places the steers and streaming answer of a buffer without history after a reload', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.send('Fix the cache', 'run-1'),
      (h) => h.dropHistory(),
      (h) => h.answer('reading the store', { tools: 1 }),
      (h) => h.steer('also the tests'),
      (h) => h.answer('third', { open: true }),
      (h) => h.reloadRenderer('session'),
      (h) => h.answer('after the reload'),
      (h) => h.steer('and the docs'),
      (h) => h.answer('last'),
      (h) => h.endRun(),
    ])
  })
})
