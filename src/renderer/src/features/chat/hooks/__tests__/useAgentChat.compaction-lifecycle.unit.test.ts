// @vitest-environment jsdom

import type { AgentSendReport } from '@shared/types/agent'
import { MessageId, SessionId, SupportedModelId } from '@shared/types/brand'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  apiMock,
  createDeferred,
  createSession,
  createSessionWithMessages,
  emitAgentEvent,
  emitRunCompleted,
  installUseAgentChatTestLifecycle,
  useAgentChat,
} from './useAgentChat.test-utils'

describe('useAgentChat compaction lifecycle', () => {
  installUseAgentChatTestLifecycle()

  it('keeps the foreground run active after automatic compaction fails', async () => {
    const send = createDeferred<AgentSendReport>()
    apiMock.sendMessage.mockReturnValueOnce(send.promise)
    const { result } = renderHook(() =>
      useAgentChat(
        SessionId('session-1'),
        createSession(),
        SupportedModelId('claude-sonnet-4-5'),
        'medium',
      ),
    )

    let sendPromise: Promise<void> | null = null
    await act(async () => {
      sendPromise = result.current.sendMessage({
        text: 'Hello',
        thinkingLevel: 'medium',
        attachments: [],
      })
      await Promise.resolve()
    })

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
          result: null,
          aborted: false,
          willRetry: false,
          errorMessage: 'Native and portable compaction failed',
          timestamp: 2,
        },
      })
    })

    expect(result.current.error?.message).toBe('Native and portable compaction failed')
    expect(result.current.status).toBe('streaming')
    expect(result.current.isLoading).toBe(true)

    await act(async () => {
      send.resolve({ outcome: 'delivered' })
      emitRunCompleted({ sessionId: SessionId('session-1') })
      await sendPromise
    })
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

  it('does not show a terminal error when the user stops during a retry delay', async () => {
    const { result } = renderHook(() =>
      useAgentChat(
        SessionId('session-1'),
        createSession(),
        SupportedModelId('spark/GLM-5.3-Flash-EXL3'),
        'medium',
      ),
    )

    await act(async () => {
      emitAgentEvent({
        sessionId: SessionId('session-1'),
        event: {
          type: 'agent_end',
          runId: 'run-1',
          reason: 'error',
          error: { message: 'terminated' },
          willRetry: true,
          timestamp: 0,
        },
      })
      emitAgentEvent({
        sessionId: SessionId('session-1'),
        event: {
          type: 'auto_retry_start',
          attempt: 1,
          maxAttempts: 3,
          delayMs: 1_000,
          errorMessage: 'terminated',
          timestamp: 1,
        },
      })
      emitAgentEvent({
        sessionId: SessionId('session-1'),
        event: {
          type: 'auto_retry_end',
          success: false,
          attempt: 1,
          cancelled: true,
          timestamp: 2,
        },
      })
    })

    expect(result.current.error).toBeUndefined()
    expect(result.current.status).toBe('ready')
  })
})
