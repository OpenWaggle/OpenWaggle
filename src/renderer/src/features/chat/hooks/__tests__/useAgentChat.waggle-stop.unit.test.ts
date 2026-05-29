// @vitest-environment jsdom

import { MessageId, SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import type { WaggleConfig } from '@shared/types/waggle'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  apiMock,
  createSessionWithMessages,
  emitAgentEvent,
  emitRunCompleted,
  installUseAgentChatTestLifecycle,
  SEND_PAYLOAD,
  useAgentChat,
} from './useAgentChat.test-utils'

const waggleConfig: WaggleConfig = {
  mode: 'sequential',
  agents: [
    {
      label: 'Advocate',
      model: SupportedModelId('openai/gpt-5.5'),
      roleDescription: 'Argues for the proposal',
      color: 'emerald',
    },
    {
      label: 'Critic',
      model: SupportedModelId('openai/gpt-5.5'),
      roleDescription: 'Challenges the proposal',
      color: 'violet',
    },
  ],
  stop: { primary: 'consensus', maxTurnsSafety: 4 },
}

function emitPartialAssistantOutput() {
  emitAgentEvent({
    sessionId: SessionId('session-1'),
    event: { type: 'agent_start', runId: 'waggle-run-1', timestamp: 1 },
  })
  emitAgentEvent({
    sessionId: SessionId('session-1'),
    event: {
      type: 'message_start',
      messageId: 'aborted-assistant-1',
      role: 'assistant',
      timestamp: 2,
    },
  })
  emitAgentEvent({
    sessionId: SessionId('session-1'),
    event: {
      type: 'message_update',
      messageId: 'aborted-assistant-1',
      role: 'assistant',
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta: 'Partial consensus text',
      },
      timestamp: 3,
    },
  })
}

function expectPartialAssistantVisible(messages: readonly unknown[]) {
  expect(messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'aborted-assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', content: 'Partial consensus text' }],
      }),
    ]),
  )
}

describe('useAgentChat Waggle stop', () => {
  installUseAgentChatTestLifecycle()

  it('keeps partial assistant output visible after a mid-turn stop snapshot refresh', async () => {
    const persistedUserOnlySession = createSessionWithMessages(2, [
      {
        id: MessageId('persisted-user-1'),
        role: 'user',
        createdAt: 1,
        parts: [{ type: 'text', text: SEND_PAYLOAD.text }],
      },
    ])
    apiMock.getSessionDetail.mockResolvedValue(persistedUserOnlySession)

    const { result, rerender } = renderHook(
      ({ session }: { readonly session: SessionDetail }) =>
        useAgentChat(
          SessionId('session-1'),
          session,
          SupportedModelId('claude-sonnet-4-5'),
          'medium',
        ),
      { initialProps: { session: createSessionWithMessages(1, []) } },
    )

    let sendPromise: Promise<void> | null = null
    await act(async () => {
      sendPromise = result.current.sendWaggleMessage(SEND_PAYLOAD, waggleConfig)
      await Promise.resolve()
    })

    await act(async () => {
      emitPartialAssistantOutput()
    })
    expectPartialAssistantVisible(result.current.messages)

    await act(async () => {
      result.current.stop()
      emitRunCompleted({ sessionId: SessionId('session-1') })
      await sendPromise
      rerender({ session: persistedUserOnlySession })
      await Promise.resolve()
    })

    expectPartialAssistantVisible(result.current.messages)
  })
})
