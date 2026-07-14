// @vitest-environment jsdom

import { SessionId, SupportedModelId } from '@shared/types/brand'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  apiMock,
  createSession,
  createSessionWithId,
  emitAgentEvent,
  emitRunCompleted,
  installUseAgentChatTestLifecycle,
  SEND_PAYLOAD,
  useAgentChat,
} from './useAgentChat.test-utils'

describe('useAgentChat streaming', () => {
  installUseAgentChatTestLifecycle()

  it('applies stream text immediately as chunks arrive', async () => {
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
    })

    expect(result.current.messages.at(-1)).toEqual(
      expect.objectContaining({
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', content: 'Working' }],
      }),
    )

    await act(async () => {
      emitRunCompleted({ sessionId: SessionId('session-1') })
      await sendPromise
    })
  })

  it('uses canonical tool input from toolcall_start without waiting for follow-up events', async () => {
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
            type: 'toolcall_start',
            contentIndex: 0,
            toolCallId: 'tool-2',
            toolName: 'read',
            input: { path: 'src/app.ts' },
          },
          timestamp: 3,
        },
      })
    })

    expect(result.current.messages.at(-1)).toEqual(
      expect.objectContaining({
        id: 'assistant-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            id: 'tool-2',
            name: 'read',
            arguments: '{"path":"src/app.ts"}',
            state: 'input-complete',
          },
        ],
      }),
    )

    await act(async () => {
      emitRunCompleted({ sessionId: SessionId('session-1') })
      await sendPromise
    })
  })

  it('tracks pending Pi interactions and submits typed responses', async () => {
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
          type: 'agent_interaction_request',
          timestamp: 1,
          interaction: {
            interactionId: 'interaction-1',
            sessionId: SessionId('session-1'),
            runId: 'run-1',
            kind: 'confirm',
            source: 'pi-ui',
            createdAt: 1,
            title: 'Continue?',
            message: 'Allow extension action?',
          },
        },
      })
    })

    expect(result.current.agentInteractions).toHaveLength(1)
    expect(result.current.agentInteractionEvents).toHaveLength(1)
    expect(result.current.agentInteractionEvents[0]).toEqual(
      expect.objectContaining({ type: 'agent_interaction_request' }),
    )

    await act(async () => {
      await result.current.respondAgentInteraction(result.current.agentInteractions[0], {
        kind: 'confirm',
        accepted: true,
      })
    })

    expect(apiMock.respondAgentInteraction).toHaveBeenCalledWith({
      sessionId: SessionId('session-1'),
      runId: 'run-1',
      interactionId: 'interaction-1',
      kind: 'confirm',
      response: { kind: 'confirm', accepted: true },
    })

    await act(async () => {
      emitAgentEvent({
        sessionId: SessionId('session-1'),
        event: {
          type: 'agent_interaction_resolved',
          timestamp: 2,
          runId: 'run-1',
          interactionId: 'interaction-1',
          kind: 'confirm',
          status: 'resolved',
          response: { kind: 'confirm', accepted: true },
        },
      })
    })

    expect(result.current.agentInteractions).toEqual([])
    expect(result.current.agentInteractionEvents).toHaveLength(2)
    expect(result.current.agentInteractionEvents[1]).toEqual(
      expect.objectContaining({ type: 'agent_interaction_resolved' }),
    )
  })

  it('clears pending interactions resolved while another session is selected', async () => {
    const sessionA = SessionId('session-a')
    const sessionB = SessionId('session-b')
    const { result, rerender } = renderHook(
      ({ sessionId }: { readonly sessionId: SessionId }) =>
        useAgentChat(
          sessionId,
          createSessionWithId(sessionId),
          SupportedModelId('claude-sonnet-4-5'),
          'medium',
        ),
      { initialProps: { sessionId: sessionA } },
    )

    await act(async () => {
      emitAgentEvent({
        sessionId: sessionA,
        event: {
          type: 'agent_interaction_request',
          timestamp: 1,
          interaction: {
            interactionId: 'interaction-offscreen',
            sessionId: sessionA,
            runId: 'run-1',
            kind: 'confirm',
            source: 'pi-ui',
            createdAt: 1,
            title: 'Continue?',
            message: 'Allow extension action?',
          },
        },
      })
    })

    expect(result.current.agentInteractions).toHaveLength(1)

    await act(async () => {
      rerender({ sessionId: sessionB })
      await Promise.resolve()
    })
    expect(result.current.agentInteractions).toEqual([])

    await act(async () => {
      emitAgentEvent({
        sessionId: sessionA,
        event: {
          type: 'agent_interaction_resolved',
          timestamp: 2,
          runId: 'run-1',
          interactionId: 'interaction-offscreen',
          kind: 'confirm',
          status: 'cancelled',
        },
      })
    })

    await act(async () => {
      rerender({ sessionId: sessionA })
      await Promise.resolve()
    })

    expect(result.current.agentInteractions).toEqual([])
    expect(result.current.agentInteractionEvents.map((event) => event.type)).toEqual([
      'agent_interaction_request',
      'agent_interaction_resolved',
    ])
  })
})
