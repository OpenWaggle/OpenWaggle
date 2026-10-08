import { expect } from 'vitest'
import {
  createTranscriptOrderHarness,
  loadTranscriptOrderHooks,
  type TranscriptOrderHarness,
} from './transcript-order.test-harness'
import { transcriptOrderViolations } from './transcript-order.violations'

/*
 * Transcript order invariant, checked at every step: every message the chat shows appears once,
 * in the Pi entry order, with its whole text; a promoted steer Pi has not incorporated yet is shown
 * last; and, while no event or Host read is held back, every message the renderer was told about
 * is shown (`transcript-order.knowledge.ts`): only answers lost in a stall may be missing until
 * their Run ends. Once a Run ends, the transcript is the Pi log exactly.
 */

const hooks = await loadTranscriptOrderHooks()

export type ScenarioStep = (harness: TranscriptOrderHarness) => unknown

export function createScenarioHarness(options: { readonly lagMs?: number } = {}) {
  return createTranscriptOrderHarness(hooks, options)
}

/** Fails with the step trace when the shown transcript breaks the invariant. */
export function assertTranscriptOrder(
  harness: TranscriptOrderHarness,
  label: string,
  trace: string[],
) {
  trace.push(`${label}: ${harness.shownKeys().join(' | ')}`)
  harness.noteShown()
  const violations = [
    ...transcriptOrderViolations(
      harness.shownKeys(),
      harness.truthKeys(),
      harness.pendingPreviewKeys(),
    ),
    ...harness.missingKeys(),
    // Once nothing is held back, whether the chat shows as running must match the Host.
    ...(harness.stillRunning() ? ['shown as running after its Run settled'] : []),
    ...(harness.idleWhileRunning() ? ['shown idle while its Run runs'] : []),
  ]
  if (violations.length === 0) return
  throw new Error(
    `${label}: ${violations.join('; ')}\nPi log: ${harness.truthKeys().join(' | ')}\n${trace.join('\n')}`,
  )
}

/** Runs the steps, checking the invariant after each, then that the transcript is the Pi log. */
export async function expectCompleteTranscript(
  steps: readonly ScenarioStep[],
  options: { readonly lagMs?: number } = {},
) {
  const harness = createScenarioHarness(options)
  const trace: string[] = []
  for (const [index, step] of steps.entries()) {
    await step(harness)
    await harness.settle()
    assertTranscriptOrder(harness, `step ${String(index)}`, trace)
  }
  expect(harness.shownKeys()).toEqual(harness.truthKeys())
}
