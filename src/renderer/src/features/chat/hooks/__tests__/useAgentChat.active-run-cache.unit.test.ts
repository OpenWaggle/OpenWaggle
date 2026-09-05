// @vitest-environment jsdom

import type { BackgroundRunSnapshot } from '@shared/types/background-run'
import { MessageId, SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { getUIMessageText } from '../../lib/useAgentChat.utils'
import {
  apiMock,
  createDeferred,
  createSessionWithIdAndMessages,
  emitAgentEvent,
  hasActiveRunMock,
  installUseAgentChatTestLifecycle,
  runRenderSnapshots,
  useAgentChat,
} from './useAgentChat.test-utils'

describe('useAgentChat active run cache', () => {
  installUseAgentChatTestLifecycle()

  it('settles a cached manual compaction without waiting for a run-completed event', async () => {
    const sessionId = SessionId('session-1')
    hasActiveRunMock.mockReturnValue(true)
    runRenderSnapshots.set(String(sessionId), {
      compactionStatus: {
        type: 'compacting',
        reason: 'manual',
        summaryCountAtStart: 0,
        timeline: [
          {
            id: '10:0',
            phase: 'running',
            reason: 'manual',
            summaryCountAtStart: 0,
            messageCountAtStart: 1,
          },
        ],
      },
      updatedAt: 1,
      messages: [],
    })
    const { result } = renderHook(() =>
      useAgentChat(
        sessionId,
        createSessionWithIdAndMessages(sessionId, 1, []),
        SupportedModelId('claude-sonnet-4-5'),
        'medium',
      ),
    )
    await waitFor(() => expect(result.current.backgroundStreaming).toBe(true))
    await waitFor(() => expect(apiMock.onAgentEvent).toHaveBeenCalled())

    hasActiveRunMock.mockReturnValue(false)
    await act(async () => {
      emitAgentEvent({
        sessionId,
        event: {
          type: 'compaction_end',
          reason: 'manual',
          result: {},
          aborted: false,
          willRetry: false,
          timestamp: 11,
        },
      })
    })

    expect(result.current.compactionStatus?.type).toBe('completed')
    await waitFor(() => expect(result.current.backgroundStreaming).toBe(false))
    expect(result.current.status).toBe('ready')
    expect(result.current.isLoading).toBe(false)
  })

  it('does not resurrect an acknowledged compaction after navigating to an older branch', async () => {
    const sessionId = SessionId('session-compaction')
    const initialSession = createSessionWithIdAndMessages(sessionId, 1, [
      {
        id: MessageId('older-user'),
        role: 'user',
        createdAt: 1,
        parts: [{ type: 'text', text: 'Older branch' }],
      },
    ])
    hasActiveRunMock.mockReturnValue(true)
    runRenderSnapshots.set(String(sessionId), {
      compactionStatus: {
        type: 'completed',
        reason: 'threshold',
        summaryCountAtStart: 0,
        timeline: [
          {
            id: '10:0',
            phase: 'completed',
            reason: 'threshold',
            summaryCountAtStart: 0,
            expectedSummaryCount: 1,
            expectedSummaryId: 'latest-summary',
            messageCountAtStart: 1,
          },
        ],
      },
      updatedAt: 1,
      messages: [],
    })

    const { result, rerender } = renderHook(
      ({ session }: { readonly session: SessionDetail }) =>
        useAgentChat(sessionId, session, SupportedModelId('claude-sonnet-4-5'), 'medium'),
      { initialProps: { session: initialSession } },
    )

    await waitFor(() => expect(result.current.compactionStatus?.type).toBe('completed'))

    hasActiveRunMock.mockReturnValue(false)
    rerender({
      session: createSessionWithIdAndMessages(sessionId, 2, [
        ...initialSession.messages,
        {
          id: MessageId('latest-summary'),
          role: 'assistant',
          createdAt: 2,
          parts: [{ type: 'text', text: 'Durable compacted context' }],
          metadata: {
            compactionSummary: { summary: 'Durable compacted context', tokensBefore: 80 },
          },
        },
      ]),
    })

    await waitFor(() => expect(result.current.compactionStatus).toBeNull())
    expect(runRenderSnapshots.get(String(sessionId))?.compactionStatus).toBeNull()

    rerender({ session: createSessionWithIdAndMessages(sessionId, 3, initialSession.messages) })

    await waitFor(() => expect(result.current.compactionStatus).toBeNull())
  })

  it('keeps active run render caches isolated across sessions with the same starter prompt', async () => {
    const sessionA = SessionId('session-a')
    const sessionB = SessionId('session-b')
    const prompt = 'Draft a one-page summary of this app'
    hasActiveRunMock.mockReturnValue(true)
    const backgroundRun = createDeferred<BackgroundRunSnapshot>()
    apiMock.getBackgroundRun.mockReturnValue(backgroundRun.promise)
    runRenderSnapshots.set('session-a', {
      compactionStatus: null,
      updatedAt: 1,
      messages: [
        {
          id: 'optimistic-a',
          role: 'user',
          parts: [{ type: 'text', content: prompt }],
          createdAt: new Date(1),
        },
        {
          id: 'assistant-a',
          role: 'assistant',
          parts: [{ type: 'thinking', content: 'Reasoning for project A' }],
          createdAt: new Date(2),
        },
      ],
    })
    runRenderSnapshots.set('session-b', {
      compactionStatus: {
        type: 'compacting',
        reason: 'threshold',
        summaryCountAtStart: 0,
        timeline: [
          {
            id: '20:0',
            phase: 'running',
            reason: 'threshold',
            summaryCountAtStart: 0,
            messageCountAtStart: 2,
          },
        ],
      },
      updatedAt: 1,
      messages: [
        {
          id: 'optimistic-b',
          role: 'user',
          parts: [{ type: 'text', content: prompt }],
          createdAt: new Date(1),
        },
        {
          id: 'assistant-b',
          role: 'assistant',
          parts: [{ type: 'thinking', content: 'Reasoning for project B' }],
          createdAt: new Date(2),
        },
      ],
    })

    const createPersistedSession = (id: SessionId) =>
      createSessionWithIdAndMessages(id, 1, [
        {
          id: MessageId(`persisted-${String(id)}`),
          role: 'user',
          createdAt: 1,
          parts: [{ type: 'text', text: prompt }],
        },
      ])

    const { result, rerender } = renderHook(
      ({
        sessionId,
        session,
      }: {
        readonly sessionId: SessionId
        readonly session: SessionDetail
      }) => useAgentChat(sessionId, session, SupportedModelId('claude-sonnet-4-5'), 'medium'),
      {
        initialProps: {
          sessionId: sessionA,
          session: createPersistedSession(sessionA),
        },
      },
    )

    await waitFor(() => {
      expect(
        result.current.messages.filter((message) => getUIMessageText(message) === prompt),
      ).toHaveLength(1)
      expect(result.current.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'assistant-a',
            parts: [{ type: 'thinking', content: 'Reasoning for project A' }],
          }),
        ]),
      )
    })

    rerender({
      sessionId: sessionB,
      session: createPersistedSession(sessionB),
    })

    await waitFor(() => {
      expect(
        result.current.messages.filter((message) => getUIMessageText(message) === prompt),
      ).toHaveLength(1)
      expect(result.current.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'assistant-b',
            parts: [{ type: 'thinking', content: 'Reasoning for project B' }],
          }),
        ]),
      )
      expect(result.current.messages).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'assistant-a' })]),
      )
      expect(result.current.compactionStatus).toMatchObject({
        type: 'compacting',
        timeline: [{ id: '20:0', phase: 'running' }],
      })
    })

    rerender({
      sessionId: sessionA,
      session: createPersistedSession(sessionA),
    })

    await waitFor(() => expect(result.current.compactionStatus).toBeNull())

    await waitFor(() => {
      expect(
        result.current.messages.filter((message) => getUIMessageText(message) === prompt),
      ).toHaveLength(1)
      expect(result.current.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'assistant-a',
            parts: [{ type: 'thinking', content: 'Reasoning for project A' }],
          }),
        ]),
      )
      expect(result.current.messages).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'assistant-b' })]),
      )
    })
  })
})
