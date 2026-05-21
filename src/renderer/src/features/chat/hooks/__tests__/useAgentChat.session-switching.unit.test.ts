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
  SEND_PAYLOAD,
  setRunRenderMessagesMock,
  useAgentChat,
} from './useAgentChat.test-utils'

describe('useAgentChat session switching', () => {
  installUseAgentChatTestLifecycle()

  it('does not wipe an active run render snapshot with stale render output during a switch', async () => {
    const sessionA = SessionId('session-a')
    const sessionB = SessionId('session-b')
    const backgroundRun = createDeferred<BackgroundRunSnapshot>()
    hasActiveRunMock.mockImplementation((id: SessionId) => id === sessionB)
    apiMock.getBackgroundRun.mockReturnValue(backgroundRun.promise)
    runRenderSnapshots.set('session-b', {
      updatedAt: 1,
      messages: [
        {
          id: 'user-b',
          role: 'user',
          parts: [{ type: 'text', content: 'Session B prompt' }],
          createdAt: new Date(1),
        },
        {
          id: 'assistant-b',
          role: 'assistant',
          parts: [{ type: 'thinking', content: 'Session B cached answer' }],
          createdAt: new Date(2),
        },
      ],
    })

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
          session: createSessionWithIdAndMessages(sessionA, 1, [
            {
              id: MessageId('assistant-a'),
              role: 'assistant',
              createdAt: 1,
              parts: [{ type: 'text', text: 'Session A persisted answer' }],
            },
          ]),
        },
      },
    )

    await waitFor(() => {
      expect(result.current.messages.map(getUIMessageText)).toEqual(['Session A persisted answer'])
    })

    setRunRenderMessagesMock.mockClear()

    await act(async () => {
      rerender({
        sessionId: sessionB,
        session: createSessionWithIdAndMessages(sessionB, 1, []),
      })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(JSON.stringify(result.current.messages)).toContain('Session B cached answer')
    })

    const sessionBSnapshotWrites = setRunRenderMessagesMock.mock.calls.filter(
      ([id]) => id === sessionB,
    )
    expect(sessionBSnapshotWrites.length).toBeGreaterThan(0)
    for (const [, writtenMessages] of sessionBSnapshotWrites) {
      expect(writtenMessages).not.toHaveLength(0)
      const serializedMessages = JSON.stringify(writtenMessages)
      expect(serializedMessages).toContain('Session B cached answer')
      expect(serializedMessages).not.toContain('Session A persisted answer')
    }
  })

  it('does not cache an active session transcript under another active session during a switch', async () => {
    const sendA = createDeferred<void>()
    const sendB = createDeferred<void>()
    apiMock.sendMessage.mockReturnValueOnce(sendA.promise).mockReturnValueOnce(sendB.promise)

    const sessionA = SessionId('session-a')
    const sessionB = SessionId('session-b')
    const prompt = 'Draft a one-page summary of this app'

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
          session: createSessionWithIdAndMessages(sessionA, 1, []),
        },
      },
    )

    await act(async () => {
      void result.current.sendMessage({ ...SEND_PAYLOAD, text: 'Create a refactor plan' })
      await Promise.resolve()
    })

    await act(async () => {
      emitAgentEvent({
        sessionId: sessionA,
        event: {
          type: 'agent_start',
          runId: 'run-a',
          timestamp: 1,
        },
      })
      emitAgentEvent({
        sessionId: sessionA,
        event: {
          type: 'message_start',
          messageId: 'assistant-a',
          role: 'assistant',
          timestamp: 2,
        },
      })
      emitAgentEvent({
        sessionId: sessionA,
        event: {
          type: 'message_update',
          messageId: 'assistant-a',
          role: 'assistant',
          assistantMessageEvent: {
            type: 'thinking_delta',
            contentIndex: 0,
            delta: 'Reasoning that belongs to session A',
          },
          timestamp: 3,
        },
      })
    })

    expect(result.current.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'assistant-a',
          parts: [
            {
              type: 'thinking',
              content: 'Reasoning that belongs to session A',
              stepId: 'assistant-a:thinking:0',
            },
          ],
        }),
      ]),
    )

    hasActiveRunMock.mockImplementation((id: SessionId) => id === sessionB)

    await act(async () => {
      rerender({
        sessionId: sessionB,
        session: createSessionWithIdAndMessages(sessionB, 1, []),
      })
      await Promise.resolve()
    })

    expect(runRenderSnapshots.get('session-b')?.messages).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'assistant-a' })]),
    )
    expect(result.current.messages).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'assistant-a' })]),
    )

    hasActiveRunMock.mockReturnValue(false)

    await act(async () => {
      void result.current.sendMessage({ ...SEND_PAYLOAD, text: prompt })
      await Promise.resolve()
    })

    expect(result.current.messages.map(getUIMessageText)).toEqual([prompt])
    expect(result.current.messages).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'assistant-a' })]),
    )

    const sessionBRenderSnapshot = runRenderSnapshots.get('session-b')
    expect(sessionBRenderSnapshot?.messages).toEqual([
      expect.objectContaining({
        role: 'user',
        parts: [{ type: 'text', content: prompt }],
      }),
    ])

    await act(async () => {
      sendA.resolve(undefined)
      sendB.resolve(undefined)
    })
  })
})
