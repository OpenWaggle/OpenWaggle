import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SESSION_ID } from './transcript-order.persisted'
import { createScenarioHarness, expectCompleteTranscript } from './transcript-order.scenario'
import { cleanupTranscriptOrder, resetTranscriptOrderState } from './transcript-order.test-harness'

// After the harness, whose vi.mock replaces the IPC bridge the store imports.
const { useBackgroundRunStore } = await import('../../state/background-run-store')

/*
 * A Run Pi continues under its own id after its end (`HostModel.continueRun`), and a Run restored
 * at a renderer reload that starts again under its own id. Each is still the same Run.
 */

describe('transcript order through a Run Pi continues', () => {
  beforeEach(resetTranscriptOrderState)
  afterEach(cleanupTranscriptOrder)

  it('keeps the first answer when the Session is reopened after a continuation', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.send('Fix the cache', 'run-1'),
      (h) => h.answer('part one'),
      (h) => h.continueRun({ steer: 'also the tests' }),
      (h) => h.answer('part two', { tools: 1 }),
      (h) => h.view('other'),
      (h) => h.view('session'),
      (h) => h.answer('part three'),
      (h) => h.endRun(),
    ])
  })

  it('keeps the first answer when a background Session is opened after a continuation', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('other'),
      (h) => h.startRun('run-1', 'Fix the cache'),
      (h) => h.answer('part one'),
      (h) => h.continueRun({ steer: 'also the tests' }),
      (h) => h.answer('part two', { tools: 1 }),
      (h) => h.view('session'),
      (h) => h.answer('part three'),
      (h) => h.endRun(),
    ])
  })

  it('keeps the first answer through an overflow compaction and continuation', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('other'),
      (h) => h.startRun('run-1', 'Fix the cache'),
      (h) => h.answer('part one', { tools: 1 }),
      (h) => h.continueRun({ compact: true }),
      (h) => h.answer('part two'),
      (h) => h.view('session'),
      (h) => h.endRun(),
    ])
  })

  it('keeps the first answer when reopened twice after a continuation', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('other'),
      (h) => h.startRun('run-1', 'Fix the cache'),
      (h) => h.answer('part one'),
      (h) => h.continueRun(),
      (h) => h.answer('part two'),
      (h) => h.view('session'),
      (h) => h.view('other'),
      (h) => h.view('session'),
      (h) => h.endRun(),
    ])
  })

  it('keeps order through a continuation, a stall and a resync', async () => {
    await expectCompleteTranscript([
      (h) => h.mount('session'),
      (h) => h.send('Fix the cache', 'run-1'),
      (h) => h.answer('part one'),
      (h) => h.continueRun({ steer: 'also the tests' }),
      (h) => h.stall(),
      (h) => h.answer('part two'),
      (h) => h.resume(),
      (h) => h.answer('part three'),
      (h) => h.endRun(),
    ])
  })
})

describe('a Run restored at a renderer reload that starts again under its own id', () => {
  beforeEach(resetTranscriptOrderState)
  afterEach(cleanupTranscriptOrder)

  // The next Run starts before the restored Run's settlement reaches the renderer (Stop, then a
  // send); that late settlement must not take the Session for idle while the next Run streams.
  for (const restart of ['none', 'retry', 'continuation'] as const) {
    it(`keeps the next Run running after the late settlement (restart: ${restart})`, async () => {
      const h = createScenarioHarness()
      await h.mount('session')
      await h.send('Fix the cache', 'run-1')
      await h.answer('reading')
      await h.reloadRenderer('session')
      if (restart === 'retry') await h.retry()
      if (restart === 'continuation') await h.continueRun()
      await h.answer('done')
      await h.endRun({ settleLater: true })
      await h.startRun('run-2', 'next prompt')
      await h.settleRun()
      await h.settle()
      expect(useBackgroundRunStore.getState().hasActiveRun(SESSION_ID)).toBe(true)
    })
  }
})
