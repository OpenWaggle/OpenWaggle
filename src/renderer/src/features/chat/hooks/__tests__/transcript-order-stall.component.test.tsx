import { afterEach, beforeEach, describe, it } from 'vitest'
import { expectCompleteTranscript } from './transcript-order.scenario'
import { cleanupTranscriptOrder, resetTranscriptOrderState } from './transcript-order.test-harness'

describe('transcript order across a settlement lost in a stall', () => {
  beforeEach(resetTranscriptOrderState)
  afterEach(cleanupTranscriptOrder)

  // A stall (a GUI–Host disconnect) loses a Run's settlement and the next Run's start: the resync
  // relays the settlement the bridge missed, naming the Run, before it announces the next one.
  it('shows a Run settled during a stall once while the next Run streams', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.send('Fix the cache', 'run-1'),
      (h) => h.answer('reading the store', { tools: 1 }),
      (h) => h.stall(),
      (h) => h.answer('done'),
      (h) => h.endRun(),
      (h) => h.startRun('run-2', 'next prompt'),
      (h) => h.answer('next answer'),
      (h) => h.resume(),
      (h) => h.answer('more of it'),
      (h) => h.endRun(),
    ])
  })

  it('shows a background Run settled during a stall once while the next Run streams', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('other'),
      (h) => h.startRun('run-1', 'Fix the cache'),
      (h) => h.answer('reading the store', { tools: 1 }),
      (h) => h.stall(),
      (h) => h.answer('done'),
      (h) => h.endRun(),
      (h) => h.startRun('run-2', 'next prompt'),
      (h) => h.answer('next answer'),
      (h) => h.resume(),
      (h) => h.view('session'),
      (h) => h.answer('more of it'),
      (h) => h.endRun(),
    ])
  })

  it('shows a background Run settled during a stall once while its Follow-up streams', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('other'),
      (h) => h.startRun('run-1', 'Fix the cache'),
      (h) => h.answer('reading the store'),
      (h) => h.stall(),
      (h) => h.answer('done'),
      (h) => h.endRun({ continues: 'run-2', followUp: 'now add a test' }),
      (h) => h.answer('adding the test'),
      (h) => h.resume(),
      (h) => h.view('session'),
      (h) => h.answer('test added'),
      (h) => h.endRun(),
    ])
  })

  // Review r11: a send's Run ends in a stall; the resync relays its settlement, and the send's
  // reconnect reads the transcript too, holding what Runs saved meanwhile.
  it('shows a steer a continuation took in a stall before a Follow-up', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.send('Fix the cache', 'run-1'),
      (h) => h.answer('reading the store'),
      (h) => h.stall(),
      (h) => h.continueRun({ steer: 'also the tests' }),
      (h) => h.answer('second pass'),
      (h) => h.endRun({ continues: 'run-2', followUp: 'now add a test' }),
      (h) => h.answer('adding the test'),
      (h) => h.resume(),
      (h) => h.answer('test added'),
      (h) => h.endRun(),
    ])
  })

  it('shows a steer of a Run that ended in a stall while the next Run streams', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.send('Fix the cache', 'run-1'),
      (h) => h.answer('reading the store'),
      (h) => h.stall(),
      (h) => h.steer('also the tests'),
      (h) => h.answer('second pass'),
      (h) => h.endRun(),
      (h) => h.startRun('run-2', 'next prompt'),
      (h) => h.answer('next answer'),
      (h) => h.resume(),
      (h) => h.answer('more of it'),
      (h) => h.endRun(),
    ])
  })

  it('shows a whole Run that went by in a stall between two Runs', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.send('Fix the cache', 'run-1'),
      (h) => h.answer('reading the store'),
      (h) => h.stall(),
      (h) => h.endRun(),
      (h) => h.startRun('run-2', 'middle prompt'),
      (h) => h.answer('middle answer'),
      (h) => h.endRun(),
      (h) => h.startRun('run-3', 'last prompt'),
      (h) => h.answer('last answer'),
      (h) => h.resume(),
      (h) => h.answer('more of it'),
      (h) => h.endRun(),
    ])
  })
})
