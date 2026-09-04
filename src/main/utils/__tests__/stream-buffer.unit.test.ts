import { SessionId, SupportedModelId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyEventToStreamBuffer,
  clearStreamBuffer,
  getStreamBuffer,
  listStreamBuffers,
  setWorktreeLaunchSnapshot,
  startStreamBuffer,
} from '../stream-buffer'

const SESSION_ID = SessionId('session-stream-buffer')
const OTHER_SESSION_ID = SessionId('session-stream-buffer-other')
const MODEL = SupportedModelId('anthropic/claude-sonnet-4-5')
const STARTED_AT = new Date('2026-01-02T03:04:05.000Z')

function clearAllBuffers() {
  for (const buffer of listStreamBuffers()) {
    clearStreamBuffer(buffer.sessionId)
  }
}

describe('stream-buffer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(STARTED_AT)
    clearAllBuffers()
  })

  afterEach(() => {
    clearAllBuffers()
    vi.useRealTimers()
  })

  it('starts, lists, snapshots, and clears background run buffers', () => {
    startStreamBuffer(SESSION_ID, MODEL, 'classic')

    expect(listStreamBuffers()).toEqual([
      {
        activity: 'agent-run',
        sessionId: SESSION_ID,
        model: MODEL,
        mode: 'classic',
        startedAt: STARTED_AT.getTime(),
        activityEvents: [],
      },
    ])
    expect(getStreamBuffer(SESSION_ID)).toEqual({
      activity: 'agent-run',
      sessionId: SESSION_ID,
      model: MODEL,
      mode: 'classic',
      startedAt: STARTED_AT.getTime(),
      parts: [],
      activityEvents: [],
    })

    clearStreamBuffer(SESSION_ID)
    expect(getStreamBuffer(SESSION_ID)).toBeNull()
  })

  it('keeps worktree launch progress in the reconnectable run snapshot', () => {
    startStreamBuffer(SESSION_ID, MODEL, 'classic')

    setWorktreeLaunchSnapshot(SESSION_ID, {
      status: 'running',
      stage: 'checking-out-files',
      startedAt: STARTED_AT.getTime(),
      updatedAt: STARTED_AT.getTime(),
      details: ['Creating ow/session-session-stream-buffer from main'],
    })

    expect(getStreamBuffer(SESSION_ID)?.worktreeLaunch).toEqual({
      status: 'running',
      stage: 'checking-out-files',
      startedAt: STARTED_AT.getTime(),
      updatedAt: STARTED_AT.getTime(),
      details: ['Creating ow/session-session-stream-buffer from main'],
    })
  })

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

  it('accumulates assistant text, reasoning, tool calls, and tool results from transport events', () => {
    startStreamBuffer(SESSION_ID, MODEL, 'waggle')

    applyEventToStreamBuffer(SESSION_ID, {
      type: 'message_start',
      messageId: 'assistant-message-1',
      role: 'assistant',
      timestamp: 1,
    })
    applyEventToStreamBuffer(SESSION_ID, {
      type: 'message_update',
      messageId: 'assistant-message-1',
      role: 'assistant',
      timestamp: 2,
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'hello' },
    })
    applyEventToStreamBuffer(SESSION_ID, {
      type: 'message_update',
      messageId: 'assistant-message-1',
      role: 'assistant',
      timestamp: 3,
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: ' world' },
    })
    applyEventToStreamBuffer(SESSION_ID, {
      type: 'message_update',
      messageId: 'assistant-message-1',
      role: 'assistant',
      timestamp: 4,
      assistantMessageEvent: { type: 'thinking_delta', contentIndex: 1, delta: 'reasoning' },
    })
    applyEventToStreamBuffer(SESSION_ID, {
      type: 'tool_execution_start',
      toolCallId: 'tool-1',
      toolName: 'read',
      args: { path: 'src/app.ts' },
      timestamp: 5,
    })
    applyEventToStreamBuffer(SESSION_ID, {
      type: 'tool_execution_end',
      toolCallId: 'tool-1',
      toolName: 'read',
      args: { path: 'src/app.ts' },
      result: 'file contents',
      isError: false,
      timestamp: 6,
    })

    expect(getStreamBuffer(SESSION_ID)).toMatchObject({
      messageId: 'assistant-message-1',
      parts: [
        { type: 'text', text: 'hello world' },
        { type: 'reasoning', text: 'reasoning' },
        {
          type: 'tool-call',
          toolCall: {
            id: 'tool-1',
            name: 'read',
            args: { path: 'src/app.ts' },
            state: 'input-complete',
          },
        },
        {
          type: 'tool-result',
          toolResult: { id: 'tool-1', name: 'read', result: 'file contents', isError: false },
        },
      ],
    })
  })

  it('resets buffered parts when a new assistant message starts', () => {
    startStreamBuffer(SESSION_ID, MODEL, 'classic')
    applyEventToStreamBuffer(SESSION_ID, {
      type: 'message_update',
      messageId: 'assistant-message-1',
      role: 'assistant',
      timestamp: 1,
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'old text' },
    })

    applyEventToStreamBuffer(SESSION_ID, {
      type: 'message_start',
      messageId: 'assistant-message-2',
      role: 'assistant',
      timestamp: 2,
    })

    expect(getStreamBuffer(SESSION_ID)).toMatchObject({
      messageId: 'assistant-message-2',
      parts: [],
    })
  })

  it('ignores events for sessions without an active buffer', () => {
    applyEventToStreamBuffer(OTHER_SESSION_ID, {
      type: 'message_update',
      messageId: 'assistant-message-1',
      role: 'assistant',
      timestamp: 1,
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'ignored' },
    })

    expect(getStreamBuffer(OTHER_SESSION_ID)).toBeNull()
  })
})
