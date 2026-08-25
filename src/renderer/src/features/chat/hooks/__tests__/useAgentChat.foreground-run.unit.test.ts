// @vitest-environment jsdom

import type { AgentSendReport } from '@shared/types/agent'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { isReportableSendFailure, MessageNotDelivered } from '@/features/chat/lib'
import {
  apiMock,
  createDeferred,
  createSession,
  createSessionWithId,
  emitAgentEvent,
  emitRunCompleted,
  installUseAgentChatTestLifecycle,
  SEND_PAYLOAD,
  useAgentChat,
} from './useAgentChat.test-utils'

describe('useAgentChat foreground run', () => {
  installUseAgentChatTestLifecycle()
  it('streams optimistic user and assistant text through OpenWaggle runtime events', async () => {
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
      sendPromise = result.current.sendMessage(SEND_PAYLOAD)
    })

    expect(apiMock.sendMessage).toHaveBeenCalledWith(
      SessionId('session-1'),
      SEND_PAYLOAD,
      SupportedModelId('claude-sonnet-4-5'),
    )
    expect(result.current.messages.at(-1)?.role).toBe('user')

    await act(async () => {
      emitAgentEvent({
        sessionId: SessionId('session-1'),
        event: {
          type: 'agent_start',
          runId: 'run-1',
          timestamp: 1,
        },
      })
      emitAgentEvent({
        sessionId: SessionId('session-1'),
        event: {
          type: 'message_start',
          messageId: 'assistant-1',
          role: 'assistant',
          timestamp: 2,
        },
      })
      emitAgentEvent({
        sessionId: SessionId('session-1'),
        event: {
          type: 'message_update',
          messageId: 'assistant-1',
          role: 'assistant',
          assistantMessageEvent: {
            type: 'text_delta',
            contentIndex: 0,
            delta: 'Working',
          },
          timestamp: 3,
        },
      })
      emitRunCompleted({ sessionId: SessionId('session-1') })
      await sendPromise
    })

    expect(result.current.messages.at(-1)).toEqual(
      expect.objectContaining({
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', content: 'Working' }],
      }),
    )
  })

  it('surfaces send failures and clears the foreground run loading state', async () => {
    const failure = new Error('Invalid arguments for "agent:send-message"')
    apiMock.sendMessage.mockRejectedValueOnce(failure)

    const { result } = renderHook(() =>
      useAgentChat(
        SessionId('session-1'),
        createSession(),
        SupportedModelId('claude-sonnet-4-5'),
        'medium',
      ),
    )

    await act(async () => {
      await expect(result.current.sendMessage(SEND_PAYLOAD)).rejects.toThrow(
        'Invalid arguments for "agent:send-message"',
      )
    })

    expect(result.current.error).toBe(failure)
    expect(result.current.status).toBe('error')
    expect(result.current.isLoading).toBe(false)
  })

  it('settles a foreground send when the run is cancelled', async () => {
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
      sendPromise = result.current.sendMessage(SEND_PAYLOAD)
    })

    await act(async () => {
      result.current.stop()
      await sendPromise
    })

    expect(apiMock.cancelAgent).toHaveBeenCalledWith(SessionId('session-1'))
    expect(result.current.status).toBe('ready')
  })

  it('does not fail a foreground send when the selected session changes mid-run', async () => {
    // The send resolves with main's report of the run, as the real channel does.
    const send = createDeferred<AgentSendReport>()
    apiMock.sendMessage.mockReturnValueOnce(send.promise)

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
          sessionId: SessionId('session-1'),
          session: createSessionWithId(SessionId('session-1')),
        },
      },
    )

    let sendPromise: Promise<void> | null = null
    await act(async () => {
      sendPromise = result.current.sendMessage(SEND_PAYLOAD)
      await Promise.resolve()
    })

    expect(result.current.status).toBe('submitted')

    await act(async () => {
      rerender({
        sessionId: SessionId('session-2'),
        session: createSessionWithId(SessionId('session-2')),
      })
      await Promise.resolve()
    })

    await act(async () => {
      send.resolve({ outcome: 'delivered' })
      await expect(sendPromise).resolves.toBeUndefined()
    })

    expect(result.current.status).toBe('ready')
    expect(result.current.error).toBeUndefined()
  })

  it('ignores events from a stale session subscription after the selected session changes', async () => {
    const sessionA = SessionId('session-a')
    const sessionB = SessionId('session-b')

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
          session: createSessionWithId(sessionA),
        },
      },
    )

    await act(async () => {
      rerender({
        sessionId: sessionB,
        session: createSessionWithId(sessionB),
      })
      await Promise.resolve()
    })

    await act(async () => {
      emitAgentEvent({
        sessionId: sessionA,
        event: {
          type: 'agent_start',
          runId: 'stale-run-a',
          timestamp: 1,
        },
      })
    })

    expect(result.current.status).toBe('ready')
    expect(result.current.backgroundStreaming).toBe(false)
    expect(result.current.messages).toEqual([])
  })

  it('reports a cancelled send without putting the session into an error state', async () => {
    /*
     * A cancellation has to reach the caller, because work submitted with the message - a review - was cleared
     * before the send and is restored only on a failure. But it must not travel the run-failure path: that
     * tears the run down and sets an error status, and "queue a follow-up, then press Stop" makes the run being
     * torn down the *replacement*. Stopping settles the run, the queued send begins immediately, and the
     * superseded send's reply arrives afterwards - by which time the session-wide delivery evidence has been
     * cleared by that replacement. So the rejection carries its outcome, and the session is left alone.
     */
    const send = createDeferred<AgentSendReport>()
    apiMock.sendMessage.mockReturnValueOnce(send.promise)

    const { result } = renderHook(() =>
      useAgentChat(
        SessionId('session-1'),
        createSessionWithId(SessionId('session-1')),
        SupportedModelId('claude-sonnet-4-5'),
        'medium',
      ),
    )

    // Captured up front, so the rejection is never momentarily unobserved.
    let sendOutcome: unknown = null
    await act(async () => {
      void result.current.sendMessage(SEND_PAYLOAD).catch((error: unknown) => {
        sendOutcome = error
      })
      await Promise.resolve()
    })

    await act(async () => {
      send.resolve({ outcome: 'cancelled' })
      result.current.stop()
      await Promise.resolve()
    })

    expect(sendOutcome).toBeInstanceOf(MessageNotDelivered)
    expect(sendOutcome).toMatchObject({ outcome: 'cancelled' })
    // The user's own Stop is not worth reporting to them as a failure.
    expect(isReportableSendFailure(sendOutcome)).toBe(false)
    // Not an error state: the run this would have torn down may be the one that replaced it.
    expect(result.current.status).not.toBe('error')
    expect(result.current.error).toBeUndefined()
  })
})
