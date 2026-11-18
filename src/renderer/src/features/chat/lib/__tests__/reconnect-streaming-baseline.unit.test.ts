import type { BackgroundRunSnapshot } from '@shared/types/background-run'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { streamingBaselineOf } from '../reconnect-buffer-anchors'

/*
 * The Host's caps count over the Run: an earlier answer they cut leaves the buffer holding all of
 * the one streaming now, whose reconnect must still recover what a stall lost from the live view.
 */

const SNAPSHOT: BackgroundRunSnapshot = {
  activity: 'agent-run',
  sessionId: SessionId('session-baseline'),
  runId: 'run-1',
  model: SupportedModelId('provider/model'),
  mode: 'classic',
  startedAt: 1,
  activityEvents: [],
  messageId: 'a2',
  parts: [{ type: 'text', text: 'Plan.', contentIndex: 0 }],
}

const degradedOf = (messageCutShort: boolean) =>
  streamingBaselineOf(
    {
      ...SNAPSHOT,
      degraded: {
        reason: 'content-limit',
        omittedBytes: 10,
        messageCutShort,
      },
    },
    () => [],
  )?.degraded

describe('streamingBaselineOf', () => {
  it('takes the streaming answer as cut only when the caps cut it', () => {
    expect(degradedOf(false)).toBe(false)
    expect(degradedOf(true)).toBe(true)
    expect(streamingBaselineOf(SNAPSHOT, () => [])?.degraded).toBe(false)
  })
})
