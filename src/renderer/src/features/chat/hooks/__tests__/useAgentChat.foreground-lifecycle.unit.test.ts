// @vitest-environment jsdom

import { MessageId, SessionId, SupportedModelId } from '@shared/types/brand'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  apiMock,
  createSession,
  createSessionWithMessages,
  emitAgentEvent,
  installUseAgentChatTestLifecycle,
  SEND_PAYLOAD,
  useAgentChat,
} from './useAgentChat.test-utils'

describe('useAgentChat foreground lifecycle', () => {
  installUseAgentChatTestLifecycle()
  it('sends native steering without settling the active foreground state', async () => {
    const { result } = renderHook(() =>
      useAgentChat(
        SessionId('session-1'),
        createSession(),
        SupportedModelId('claude-sonnet-4-5'),
        'medium',
      ),
    )

    await act(async () => {
      emitAgentEvent({
        sessionId: SessionId('session-1'),
        event: { type: 'compaction_start', reason: 'threshold', timestamp: 1 },
      })
    })

    await act(async () => {
      await result.current.steer(SEND_PAYLOAD)
    })

    expect(apiMock.steerAgent).toHaveBeenCalledWith(SessionId('session-1'), SEND_PAYLOAD)
    expect(result.current.status).toBe('compacting')
  })

  it('surfaces compaction lifecycle events as foreground activity', async () => {
    const { result } = renderHook(() =>
      useAgentChat(
        SessionId('session-1'),
        createSession(),
        SupportedModelId('claude-sonnet-4-5'),
        'medium',
      ),
    )

    await act(async () => {
      emitAgentEvent({
        sessionId: SessionId('session-1'),
        event: {
          type: 'compaction_start',
          reason: 'manual',
          timestamp: 1,
        },
      })
    })

    expect(result.current.status).toBe('compacting')
    expect(result.current.isLoading).toBe(true)
    expect(result.current.compactionStatus).toEqual({
      type: 'compacting',
      reason: 'manual',
      summaryCountAtStart: 0,
      timeline: [
        {
          id: '1:0',
          phase: 'running',
          reason: 'manual',
          summaryCountAtStart: 0,
          expectedSummaryCount: 1,
          messageCountAtStart: 1,
        },
      ],
    })

    await act(async () => {
      emitAgentEvent({
        sessionId: SessionId('session-1'),
        event: {
          type: 'compaction_end',
          reason: 'manual',
          result: {
            summary: 'Kept the active task context.',
            firstKeptEntryId: 'kept-user',
            tokensBefore: 123456,
          },
          aborted: false,
          willRetry: false,
          timestamp: 2,
        },
      })
    })

    expect(result.current.status).toBe('ready')
    expect(result.current.isLoading).toBe(false)
    expect(result.current.compactionStatus).toEqual({
      type: 'completed',
      reason: 'manual',
      summaryCountAtStart: 0,
      timeline: [
        {
          id: '1:0',
          phase: 'completed',
          reason: 'manual',
          summaryCountAtStart: 0,
          expectedSummaryCount: 1,
          messageCountAtStart: 1,
        },
      ],
    })
  })

  it('uses the durable summary baseline when compaction start was missed', async () => {
    const session = createSessionWithMessages(2, [
      ...createSession().messages,
      {
        id: MessageId('summary-1'),
        role: 'assistant',
        createdAt: 2,
        parts: [{ type: 'text', text: 'Prior checkpoint' }],
        metadata: {
          compactionSummary: { summary: 'Prior checkpoint', tokensBefore: 100 },
        },
      },
    ])
    const { result } = renderHook(() =>
      useAgentChat(
        SessionId('session-1'),
        session,
        SupportedModelId('claude-sonnet-4-5'),
        'medium',
      ),
    )

    await act(async () => {
      emitAgentEvent({
        sessionId: SessionId('session-1'),
        event: {
          type: 'compaction_end',
          reason: 'threshold',
          result: {},
          aborted: false,
          willRetry: false,
          timestamp: 3,
        },
      })
    })

    expect(result.current.compactionStatus).toMatchObject({
      type: 'completed',
      summaryCountAtStart: 1,
      timeline: [{ summaryCountAtStart: 1, messageCountAtStart: 2 }],
    })
  })

  it('preserves a completed compaction marker through automatic retry', async () => {
    const { result } = renderHook(() =>
      useAgentChat(
        SessionId('session-1'),
        createSession(),
        SupportedModelId('claude-sonnet-4-5'),
        'medium',
      ),
    )

    await act(async () => {
      emitAgentEvent({
        sessionId: SessionId('session-1'),
        event: { type: 'compaction_start', reason: 'threshold', timestamp: 1 },
      })
      emitAgentEvent({
        sessionId: SessionId('session-1'),
        event: {
          type: 'compaction_end',
          reason: 'threshold',
          result: {},
          aborted: false,
          willRetry: false,
          timestamp: 2,
        },
      })
      emitAgentEvent({
        sessionId: SessionId('session-1'),
        event: {
          type: 'auto_retry_start',
          attempt: 1,
          maxAttempts: 3,
          delayMs: 100,
          errorMessage: 'temporary error',
          timestamp: 3,
        },
      })
    })

    expect(result.current.compactionStatus).toMatchObject({
      type: 'retrying',
      previousCompactionStatus: {
        type: 'completed',
        timeline: [{ phase: 'completed' }],
      },
    })

    await act(async () => {
      emitAgentEvent({
        sessionId: SessionId('session-1'),
        event: { type: 'auto_retry_end', success: true, attempt: 1, timestamp: 4 },
      })
    })

    expect(result.current.compactionStatus).toMatchObject({
      type: 'completed',
      timeline: [{ phase: 'completed' }],
    })
  })
})
