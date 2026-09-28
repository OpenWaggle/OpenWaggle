// @vitest-environment jsdom

import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MessageDeliveredRunFailed } from '../../lib/message-delivery'
import { useOptimisticUserMessageStore } from '../../state/optimistic-user-message-store'
import {
  apiMock,
  createDeferred,
  createSession,
  emitAgentEvent,
  emitRunCompleted,
  installUseAgentChatTestLifecycle,
  SEND_PAYLOAD,
  useAgentChat,
} from './useAgentChat.test-utils'

const SESSION_ID = SessionId('session-1')
const MODEL = SupportedModelId('openrouter/anthropic/claude-haiku-4.5')
const BILLING_ERROR = '402 This request requires more credits'
const QUEUED_PAYLOAD = { ...SEND_PAYLOAD, text: 'Try again' }

function renderChat() {
  return renderHook(() => useAgentChat(SESSION_ID, createSession(), MODEL, 'medium'))
}

function failRun(runId: string) {
  emitAgentEvent({
    sessionId: SESSION_ID,
    event: { type: 'agent_start', runId, model: MODEL, timestamp: 1 },
  })
  emitAgentEvent({
    sessionId: SESSION_ID,
    event: {
      type: 'agent_end',
      runId,
      reason: 'error',
      error: { message: BILLING_ERROR, code: 'billing' },
      timestamp: 2,
    },
  })
}

function visibleUserTexts(messages: readonly UIMessage[]) {
  return messages
    .filter((message) => message.role === 'user')
    .flatMap((message) =>
      message.parts.flatMap((part) => (part.type === 'text' ? [part.content] : [])),
    )
}

/*
 * The Host keeps a message as a Follow-up instead of starting a Run whenever the Session still has a
 * Run or has Follow-ups waiting. A failed Run pauses the queue, so after a provider failure a message
 * typed into an idle Session joined the paused queue - and the renderer, told the send was
 * "delivered", waited for a Run that did not exist: Stop and "Thinking" stayed up with no Run on the
 * Host, and every later message was queued too.
 */
describe('useAgentChat send that the Host queued', () => {
  installUseAgentChatTestLifecycle()

  it('returns an idle Session to its settled state instead of waiting for a Run', async () => {
    const { result } = renderChat()

    let firstSend: Promise<void> | null = null
    await act(async () => {
      firstSend = result.current.sendMessage(SEND_PAYLOAD).catch(() => undefined)
    })
    await act(async () => {
      failRun('run-1')
      emitRunCompleted({ sessionId: SESSION_ID })
      await firstSend
    })
    expect(result.current.status).toBe('error')

    apiMock.sendMessage.mockResolvedValueOnce({ outcome: 'queued' })
    await act(async () => {
      await result.current.sendMessage(QUEUED_PAYLOAD)
    })

    expect(result.current.isLoading).toBe(false)
    expect(result.current.status).toBe('error')
    expect(result.current.error?.message).toBe(BILLING_ERROR)
    // The message lives in the Follow-up queue now; it is not a turn in the transcript.
    expect(visibleUserTexts(result.current.messages)).not.toContain(QUEUED_PAYLOAD.text)
    const optimistic = useOptimisticUserMessageStore.getState().messagesBySessionId.get(SESSION_ID)
    expect(visibleUserTexts(optimistic ?? [])).not.toContain(QUEUED_PAYLOAD.text)
  })

  it('keeps following the Run that is still settling when a send is queued behind it', async () => {
    const { result } = renderChat()

    let firstOutcome: unknown = 'pending'
    await act(async () => {
      void result.current.sendMessage(SEND_PAYLOAD).then(
        () => {
          firstOutcome = 'resolved'
        },
        (error: unknown) => {
          firstOutcome = error
        },
      )
    })
    // Pi reported the failure; the Host has not settled the Run yet, so it queues the next message.
    await act(async () => {
      failRun('run-1')
    })

    apiMock.sendMessage.mockResolvedValueOnce({ outcome: 'queued' })
    await act(async () => {
      await result.current.sendMessage(QUEUED_PAYLOAD)
    })
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error?.message).toBe(BILLING_ERROR)
    expect(firstOutcome).toBe('pending')

    await act(async () => {
      emitAgentEvent({
        sessionId: SESSION_ID,
        event: {
          type: 'agent_end',
          runId: 'run-1',
          reason: 'error',
          error: { message: BILLING_ERROR, code: 'billing' },
          timestamp: 3,
        },
      })
      emitRunCompleted({ sessionId: SESSION_ID })
    })

    // The first send's Run finished, so its caller hears about it - it was not orphaned.
    expect(firstOutcome).toBeInstanceOf(MessageDeliveredRunFailed)
    expect(result.current.isLoading).toBe(false)
    expect(result.current.status).toBe('error')
  })

  it('settles the earlier send when its Run completes before the queued report arrives', async () => {
    const { result } = renderChat()

    let firstOutcome: unknown = 'pending'
    await act(async () => {
      void result.current.sendMessage(SEND_PAYLOAD).then(
        () => {
          firstOutcome = 'resolved'
        },
        (error: unknown) => {
          firstOutcome = error
        },
      )
    })
    await act(async () => {
      failRun('run-1')
    })

    const queuedReport = createDeferred<{ readonly outcome: 'queued' }>()
    apiMock.sendMessage.mockReturnValueOnce(queuedReport.promise)
    let queuedSend: Promise<void> | null = null
    await act(async () => {
      queuedSend = result.current.sendMessage(QUEUED_PAYLOAD)
    })
    await act(async () => {
      emitRunCompleted({ sessionId: SESSION_ID })
    })
    await act(async () => {
      queuedReport.resolve({ outcome: 'queued' })
      await queuedSend
    })

    expect(firstOutcome).toBeInstanceOf(MessageDeliveredRunFailed)
    expect(result.current.isLoading).toBe(false)
    expect(result.current.status).toBe('error')
    expect(result.current.error?.message).toBe(BILLING_ERROR)
  })
})
