import type { AgentSendReport } from '@shared/types/agent'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MessageNotDelivered } from '../../lib/message-delivery'
import { useOptimisticUserMessageStore } from '../../state/optimistic-user-message-store'
import {
  apiMock,
  createDeferred,
  createSession,
  createSessionWithMessages,
  firstSendRecoveryCalls,
  installUseAgentChatTestLifecycle,
  SEND_PAYLOAD,
  useAgentChat,
} from './useAgentChat.test-utils'

const SESSION_ID = SessionId('session-refused')
const MODEL = SupportedModelId('openrouter/anthropic/claude-haiku-4.5')
const REFUSED = {
  outcome: 'refused',
  message: 'queue_capacity_reached',
  code: 'queue_capacity_reached',
} as const satisfies AgentSendReport

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

  /** Two sends in a row, each answered by `reports` in turn, the earlier one's report first. */
  async function twoSendsAnsweredInOrder(reports: readonly [AgentSendReport, AgentSendReport]) {
    const answers: ((report: AgentSendReport) => void)[] = []
    apiMock.sendMessage.mockImplementation(
      () =>
        new Promise<AgentSendReport>((resolve) => {
          answers.push(resolve)
        }),
    )
    const rendered = renderHook(() => useAgentChat(SESSION_ID, createSession(), MODEL))
    const sends: Promise<unknown>[] = []
    // Separate acts, as in the app: the later send begins after the earlier one's render.
    await act(async () => {
      sends.push(rendered.result.current.sendMessage(SEND_PAYLOAD).catch((error: unknown) => error))
    })
    await act(async () => {
      sends.push(
        rendered.result.current
          .sendMessage({ ...SEND_PAYLOAD, text: 'A later message' })
          .catch((error: unknown) => error),
      )
    })
    await act(async () => {
      answers[0]?.(reports[0])
      await sends[0]
    })
    const betweenStatus = rendered.result.current.status
    await act(async () => {
      answers[1]?.(reports[1])
      await sends[1]
    })
    return { result: rendered.result, betweenStatus, sends }
  }

  it('leaves a later send’s Thinking alone when an earlier send is refused', async () => {
    const { betweenStatus } = await twoSendsAnsweredInOrder([REFUSED, REFUSED])

    expect(betweenStatus).toBe('submitted')
  })

  it.each([
    ['refused', REFUSED],
    ['queued', { outcome: 'queued' } as const],
  ])('returns to ready once two %s sends have both ended', async (_label, report) => {
    const { result } = await twoSendsAnsweredInOrder([report, report])

    expect(result.current.status).toBe('ready')
    expect(result.current.isLoading).toBe(false)
    expect(visibleUserTexts(result.current.messages)).not.toContain('A later message')
  })

  // The earlier send ended without a Run too: left in the chain, the later one handed back its
  // Thinking and a waiter nothing would settle.
  it.each([
    ['refused', REFUSED],
    ['queued', { outcome: 'queued' } as const],
  ])('returns to ready when an earlier send fails and a later one is %s', async (_, report) => {
    let failEarlier: (error: Error) => void = () => {}
    const earlier = new Promise<AgentSendReport>((_resolve, reject) => {
      failEarlier = reject
    })
    const later = createDeferred<AgentSendReport>()
    apiMock.sendMessage.mockReturnValueOnce(earlier).mockReturnValueOnce(later.promise)
    const { result } = renderHook(() => useAgentChat(SESSION_ID, createSession(), MODEL))
    const sends: Promise<unknown>[] = []
    await act(async () => {
      sends.push(result.current.sendMessage(SEND_PAYLOAD).catch((error: unknown) => error))
    })
    await act(async () => {
      sends.push(
        result.current
          .sendMessage({ ...SEND_PAYLOAD, text: 'A later message' })
          .catch((error: unknown) => error),
      )
    })
    await act(async () => {
      failEarlier(new Error('handler died'))
      await sends[0]
    })
    await act(async () => {
      later.resolve(report)
      await sends[1]
    })

    expect(result.current.status).not.toBe('submitted')
    expect(result.current.isLoading).toBe(false)
  })

  // A later send owns the status, so no error of the Session's shows this failure: the message
  // leaves the transcript and goes back undelivered, for the composer's toast to say why.
  it('drops an earlier send whose invoke fails behind a later one, and reports it undelivered', async () => {
    let failEarlier: (error: Error) => void = () => {}
    const earlier = new Promise<AgentSendReport>((_resolve, reject) => {
      failEarlier = reject
    })
    const later = createDeferred<AgentSendReport>()
    apiMock.sendMessage.mockReturnValueOnce(earlier).mockReturnValueOnce(later.promise)
    const { result } = renderHook(() => useAgentChat(SESSION_ID, createSession(), MODEL))
    const sends: Promise<unknown>[] = []
    await act(async () => {
      sends.push(result.current.sendMessage(SEND_PAYLOAD).catch((error: unknown) => error))
    })
    await act(async () => {
      sends.push(
        result.current
          .sendMessage({ ...SEND_PAYLOAD, text: 'A later message' })
          .catch((error: unknown) => error),
      )
    })
    let earlierError: unknown
    await act(async () => {
      failEarlier(new Error('handler died'))
      earlierError = await sends[0]
    })

    expect(earlierError).toBeInstanceOf(MessageNotDelivered)
    expect(earlierError).toMatchObject({ outcome: 'refused', message: 'handler died' })
    expect(visibleUserTexts(result.current.messages)).not.toContain(SEND_PAYLOAD.text)
    expect(visibleUserTexts(result.current.messages)).toContain('A later message')
    expect(result.current.status).toBe('submitted')
    expect(result.current.error).toBeUndefined()
  })
})
