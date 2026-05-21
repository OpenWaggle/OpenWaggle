// @vitest-environment jsdom

import type { BackgroundRunSnapshot } from '@shared/types/background-run'
import { MessageId, SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { getUIMessageText } from '../../lib/useAgentChat.utils'
import {
  apiMock,
  createDeferred,
  createSessionWithIdAndMessages,
  hasActiveRunMock,
  installUseAgentChatTestLifecycle,
  runRenderSnapshots,
  useAgentChat,
} from './useAgentChat.test-utils'

describe('useAgentChat active run cache', () => {
  installUseAgentChatTestLifecycle()

  it('keeps active run render caches isolated across sessions with the same starter prompt', async () => {
    const sessionA = SessionId('session-a')
    const sessionB = SessionId('session-b')
    const prompt = 'Draft a one-page summary of this app'
    hasActiveRunMock.mockReturnValue(true)
    const backgroundRun = createDeferred<BackgroundRunSnapshot>()
    apiMock.getBackgroundRun.mockReturnValue(backgroundRun.promise)
    runRenderSnapshots.set('session-a', {
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
    })

    rerender({
      sessionId: sessionA,
      session: createPersistedSession(sessionA),
    })

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
