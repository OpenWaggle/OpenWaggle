import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MessageNotDelivered } from '../../lib/message-delivery'
import { useOptimisticUserMessageStore } from '../../state/optimistic-user-message-store'
import {
  apiMock,
  createSession,
  createSessionWithMessages,
  firstSendRecoveryCalls,
  installUseAgentChatTestLifecycle,
  SEND_PAYLOAD,
  useAgentChat,
} from './useAgentChat.test-utils'

const SESSION_ID = SessionId('session-refused')
const MODEL = SupportedModelId('openrouter/anthropic/claude-haiku-4.5')

function visibleUserTexts(messages: readonly UIMessage[]) {
  return messages
    .filter((message) => message.role === 'user')
    .flatMap((message) =>
      message.parts.flatMap((part) => (part.type === 'text' ? [part.content] : [])),
    )
}

/*
 * The Host refused the send before any Run started (it reported `refused`). Nothing will report
 * back, so the Session must not keep showing "Thinking" and Stop over a message the agent never
 * got: it goes back to ready, the message leaves the transcript, and the caller is told why.
 */
describe('useAgentChat send the Session Host refused', () => {
  installUseAgentChatTestLifecycle()

  it('returns the Session to ready, drops the message, and reports the refusal code', async () => {
    apiMock.sendMessage.mockResolvedValueOnce({
      outcome: 'refused',
      message: 'queue_capacity_reached',
      code: 'queue_capacity_reached',
    })
    const { result } = renderHook(() => useAgentChat(SESSION_ID, createSession(), MODEL))

    let outcome: unknown = 'pending'
    await act(async () => {
      await result.current.sendMessage(SEND_PAYLOAD).catch((error: unknown) => {
        outcome = error
      })
    })

    expect(outcome).toBeInstanceOf(MessageNotDelivered)
    expect(outcome).toMatchObject({ outcome: 'refused', code: 'queue_capacity_reached' })
    expect(result.current.status).toBe('ready')
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeUndefined()
    expect(visibleUserTexts(result.current.messages)).not.toContain(SEND_PAYLOAD.text)
    const optimistic = useOptimisticUserMessageStore.getState().messagesBySessionId.get(SESSION_ID)
    expect(visibleUserTexts(optimistic ?? [])).not.toContain(SEND_PAYLOAD.text)
  })

  it('drops the recovery of a refused first message in a Session that has none yet', async () => {
    apiMock.sendMessage.mockResolvedValueOnce({
      outcome: 'refused',
      message: 'queue_capacity_reached',
      code: 'queue_capacity_reached',
    })
    const emptySession = createSessionWithMessages(1, [])
    const { result } = renderHook(() => useAgentChat(SESSION_ID, emptySession, MODEL))

    await act(async () => {
      await result.current.sendMessage(SEND_PAYLOAD).catch(() => undefined)
    })

    // Kept, a restart would offer to retry a message that is already back in the composer.
    expect(firstSendRecoveryCalls.at(-1)).toEqual([SESSION_ID, null])
  })

  it('leaves a later send’s Thinking alone when an earlier send is refused', async () => {
    let refuse: (report: { outcome: 'refused'; message: string; code: string }) => void = () => {}
    apiMock.sendMessage
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            refuse = resolve
          }),
      )
      .mockImplementationOnce(() => new Promise(() => {}))
    const { result } = renderHook(() => useAgentChat(SESSION_ID, createSession(), MODEL))

    let first: Promise<unknown> = Promise.resolve()
    await act(async () => {
      first = result.current.sendMessage(SEND_PAYLOAD).catch((error: unknown) => error)
      void result.current.sendMessage({ ...SEND_PAYLOAD, text: 'A later message' })
    })
    await act(async () => {
      refuse({
        outcome: 'refused',
        message: 'queue_capacity_reached',
        code: 'queue_capacity_reached',
      })
      await first
    })

    expect(await first).toBeInstanceOf(MessageNotDelivered)
    expect(result.current.status).toBe('submitted')
    expect(visibleUserTexts(result.current.messages)).toContain('A later message')
  })
})
