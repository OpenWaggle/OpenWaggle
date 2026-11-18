import { SessionId, SupportedModelId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyEventToStreamBuffer,
  clearStreamBuffer,
  getStreamBuffer,
  listStreamBuffers,
  replaceStreamBufferSnapshots,
  startStreamBuffer,
} from '../stream-buffer'

const SESSION_ID = SessionId('session-stream-buffer-compaction')
const MODEL = SupportedModelId('anthropic/claude-sonnet-4-5')

function clearAllBuffers() {
  for (const buffer of listStreamBuffers()) clearStreamBuffer(buffer.sessionId)
}

describe('stream-buffer compaction snapshots', () => {
  beforeEach(clearAllBuffers)
  afterEach(clearAllBuffers)

  it('keeps the active automatic compaction lifecycle reconnectable', () => {
    startStreamBuffer(SESSION_ID, MODEL, 'classic')
    const compactionStart = {
      type: 'compaction_start' as const,
      reason: 'threshold' as const,
      timestamp: 10,
    }

    applyEventToStreamBuffer(SESSION_ID, compactionStart)

    expect(listStreamBuffers()[0]).toMatchObject({ activityEvents: [compactionStart] })
    expect(getStreamBuffer(SESSION_ID)).toMatchObject({ activityEvents: [compactionStart] })
  })

  it('keeps a completed threshold compaction reconnectable while the run continues', () => {
    startStreamBuffer(SESSION_ID, MODEL, 'classic')
    const compactionStart = {
      type: 'compaction_start' as const,
      reason: 'threshold' as const,
      timestamp: 10,
    }
    const compactionEnd = {
      type: 'compaction_end' as const,
      reason: 'threshold' as const,
      result: {},
      aborted: false,
      willRetry: false,
      timestamp: 11,
    }

    applyEventToStreamBuffer(SESSION_ID, compactionStart)
    applyEventToStreamBuffer(SESSION_ID, compactionEnd)

    expect(listStreamBuffers()[0]).toMatchObject({
      activityEvents: [compactionStart, compactionEnd],
    })
    expect(getStreamBuffer(SESSION_ID)).toMatchObject({
      activityEvents: [compactionStart, compactionEnd],
    })
  })

  it('keeps earlier completed compactions when another compaction starts', () => {
    startStreamBuffer(SESSION_ID, MODEL, 'classic')
    const firstStart = {
      type: 'compaction_start' as const,
      reason: 'threshold' as const,
      timestamp: 10,
    }
    const firstEnd = {
      type: 'compaction_end' as const,
      reason: 'threshold' as const,
      result: { entryId: 'compaction-entry-1' },
      aborted: false,
      willRetry: false,
      timestamp: 11,
    }
    const secondStart = {
      type: 'compaction_start' as const,
      reason: 'threshold' as const,
      timestamp: 20,
    }

    applyEventToStreamBuffer(SESSION_ID, firstStart)
    applyEventToStreamBuffer(SESSION_ID, firstEnd)
    applyEventToStreamBuffer(SESSION_ID, secondStart)

    expect(getStreamBuffer(SESSION_ID)).toMatchObject({
      activityEvents: [firstStart, firstEnd, secondStart],
    })
  })

  it('keeps the retry phase linked to the automatic compaction that triggered it', () => {
    startStreamBuffer(SESSION_ID, MODEL, 'classic')
    const compactionStart = {
      type: 'compaction_start' as const,
      reason: 'threshold' as const,
      timestamp: 10,
    }
    const compactionEnd = {
      type: 'compaction_end' as const,
      reason: 'threshold' as const,
      result: {},
      aborted: false,
      willRetry: true,
      errorMessage: 'temporary failure',
      timestamp: 11,
    }
    const retryStart = {
      type: 'auto_retry_start' as const,
      attempt: 1,
      maxAttempts: 3,
      delayMs: 500,
      errorMessage: 'temporary failure',
      timestamp: 12,
    }

    applyEventToStreamBuffer(SESSION_ID, compactionStart)
    applyEventToStreamBuffer(SESSION_ID, compactionEnd)
    applyEventToStreamBuffer(SESSION_ID, retryStart)

    expect(getStreamBuffer(SESSION_ID)).toMatchObject({
      activityEvents: [compactionStart, compactionEnd, retryStart],
    })
  })

  it('preserves completed compaction history after automatic retry ends', () => {
    startStreamBuffer(SESSION_ID, MODEL, 'classic')
    const compactionStart = {
      type: 'compaction_start' as const,
      reason: 'threshold' as const,
      timestamp: 10,
    }
    const compactionEnd = {
      type: 'compaction_end' as const,
      reason: 'threshold' as const,
      result: { entryId: 'compaction-entry-1' },
      aborted: false,
      willRetry: false,
      timestamp: 11,
    }
    applyEventToStreamBuffer(SESSION_ID, compactionStart)
    applyEventToStreamBuffer(SESSION_ID, compactionEnd)
    applyEventToStreamBuffer(SESSION_ID, {
      type: 'auto_retry_start',
      attempt: 1,
      maxAttempts: 3,
      delayMs: 500,
      errorMessage: 'temporary failure',
      timestamp: 12,
    })
    applyEventToStreamBuffer(SESSION_ID, {
      type: 'auto_retry_end',
      success: true,
      attempt: 1,
      timestamp: 13,
    })

    expect(getStreamBuffer(SESSION_ID)).toMatchObject({
      activityEvents: [compactionStart, compactionEnd],
    })
  })

  it('accounts restored activity bytes through assistant resets and releases them on clear', () => {
    const event = {
      type: 'compaction_end' as const,
      reason: 'threshold' as const,
      result: { summary: 'x'.repeat(3 * 1024 * 1024) },
      aborted: false,
      willRetry: false,
      timestamp: 1,
    }
    replaceStreamBufferSnapshots([
      {
        activity: 'agent-run',
        sessionId: SESSION_ID,
        model: MODEL,
        mode: 'classic',
        startedAt: 0,
        parts: [{ type: 'text', text: 'previous response' }],
        activityEvents: [event],
      },
    ])
    applyEventToStreamBuffer(SESSION_ID, {
      type: 'message_start',
      messageId: 'next-assistant',
      role: 'assistant',
      timestamp: 2,
    })
    const append = () =>
      applyEventToStreamBuffer(SESSION_ID, {
        type: 'message_update',
        messageId: 'next-assistant',
        role: 'assistant',
        timestamp: 3,
        assistantMessageEvent: {
          type: 'text_delta',
          contentIndex: 0,
          delta: 'y'.repeat(2 * 1024 * 1024),
        },
      })
    append()
    expect(getStreamBuffer(SESSION_ID)).toMatchObject({
      parts: [],
      activityEvents: [event],
      degraded: { omittedBytes: 2 * 1024 * 1024 },
    })

    clearStreamBuffer(SESSION_ID)
    startStreamBuffer(SESSION_ID, MODEL, 'classic')
    append()
    expect(getStreamBuffer(SESSION_ID)).toMatchObject({
      parts: [{ type: 'text', text: 'y'.repeat(2 * 1024 * 1024) }],
      activityEvents: [],
    })
  })

  it('enforces the shared restore budget across activity events and later streamed text', () => {
    const otherSessionId = SessionId('other-compacting-session')
    const activity = {
      type: 'compaction_end' as const,
      reason: 'threshold' as const,
      result: { summary: 'x'.repeat(3 * 1024 * 1024) },
      aborted: false,
      willRetry: false,
      timestamp: 1,
    }
    replaceStreamBufferSnapshots(
      [SESSION_ID, otherSessionId].map((sessionId) => ({
        activity: 'agent-run',
        sessionId,
        model: MODEL,
        mode: 'classic',
        startedAt: 0,
        parts: [],
        activityEvents: [activity],
      })),
    )
    expect(getStreamBuffer(SESSION_ID)?.activityEvents).toEqual([activity])
    expect(getStreamBuffer(otherSessionId)?.activityEvents).toEqual([])

    applyEventToStreamBuffer(otherSessionId, {
      type: 'message_update',
      messageId: 'assistant',
      role: 'assistant',
      timestamp: 2,
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta: 'y'.repeat(3 * 1024 * 1024),
      },
    })
    expect(getStreamBuffer(otherSessionId)).toMatchObject({
      parts: [],
      degraded: { omittedBytes: 3 * 1024 * 1024 },
    })
  })
})
