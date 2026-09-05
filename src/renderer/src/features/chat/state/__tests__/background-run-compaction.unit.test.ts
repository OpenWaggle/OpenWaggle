import type { AgentTransportEvent } from '@shared/types/stream'
import { describe, expect, it } from 'vitest'
import { applyCompactionSnapshotEvent } from '../background-run-compaction'

const MESSAGES = [
  { id: 'user-1', role: 'user' as const, parts: [{ type: 'text' as const, content: 'Start' }] },
]

function apply(
  status: Parameters<typeof applyCompactionSnapshotEvent>[0],
  event: AgentTransportEvent,
) {
  return applyCompactionSnapshotEvent(status, event, MESSAGES)
}

describe('background compaction lifecycle', () => {
  it('restores retry state and its prior timeline across cached snapshots', () => {
    const completed = apply(null, {
      type: 'compaction_end',
      reason: 'threshold',
      result: {},
      aborted: false,
      willRetry: false,
      timestamp: 1,
    })
    const retrying = apply(completed, {
      type: 'auto_retry_start',
      attempt: 1,
      maxAttempts: 3,
      delayMs: 100,
      errorMessage: 'temporary',
      timestamp: 2,
    })

    expect(retrying).toMatchObject({
      type: 'retrying',
      previousCompactionStatus: { timeline: [{ id: '1:0', phase: 'completed' }] },
    })
    expect(
      apply(retrying, { type: 'auto_retry_end', success: true, attempt: 1, timestamp: 3 }),
    ).toEqual(completed)
  })

  it('retains earlier completions when a later compaction fails', () => {
    const completed = apply(null, {
      type: 'compaction_end',
      reason: 'threshold',
      result: {},
      aborted: false,
      willRetry: false,
      timestamp: 1,
    })
    const running = apply(completed, {
      type: 'compaction_start',
      reason: 'threshold',
      timestamp: 2,
    })
    const afterFailure = apply(running, {
      type: 'compaction_end',
      reason: 'threshold',
      result: null,
      aborted: false,
      willRetry: false,
      errorMessage: 'Compaction failed',
      timestamp: 3,
    })

    expect(afterFailure).toMatchObject({
      type: 'completed',
      timeline: [{ id: '1:0', phase: 'completed' }],
    })
  })
})
