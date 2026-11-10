import type { AgentSendReport } from '@shared/types/agent'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  clearLastAgentErrorInfo,
  getLastAgentErrorInfo,
  setLastAgentErrorInfo,
} from '../../lib/agent-error-store'
import { MessageNotDelivered } from '../../lib/message-delivery'
import { useOptimisticUserMessageStore } from '../../state/optimistic-user-message-store'
import {
  apiMock,
  createDeferred,
  createSession,
  createSessionWithIdAndMessages,
  emitAgentEvent,
  emitRunCompleted,
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

/** A Waggle that failed before it reached the agent: its Run ends in error, then the Host refuses. */
async function refuseAfterOwnFailure(result: {
  readonly current: ReturnType<typeof useAgentChat>
}) {
  const report = createDeferred<AgentSendReport>()
  apiMock.sendMessage.mockImplementationOnce(() => report.promise)
  await act(async () => {
    void result.current.sendMessage(SEND_PAYLOAD).catch(() => undefined)
  })
  await act(async () => {
    emitAgentEvent({
      sessionId: SESSION_ID,
      event: {
        type: 'agent_end',
        runId: 'run-x',
        reason: 'error',
        error: { message: 'boom' },
        timestamp: 1,
      },
    })
    emitRunCompleted({ sessionId: SESSION_ID })
  })
  await act(async () => {
    report.resolve({ outcome: 'refused', message: 'boom', code: 'waggle_failed' })
  })
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
      message: 'host_run_ceiling_reached',
      code: 'host_run_ceiling_reached',
    })
    const { result } = renderHook(() => useAgentChat(SESSION_ID, createSession(), MODEL))

    let outcome: unknown = 'pending'
    await act(async () => {
      await result.current.sendMessage(SEND_PAYLOAD).catch((error: unknown) => {
        outcome = error
      })
    })

    expect(outcome).toBeInstanceOf(MessageNotDelivered)
    expect(outcome).toMatchObject({ outcome: 'refused', code: 'host_run_ceiling_reached' })
    expect(result.current.status).toBe('ready')
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeUndefined()
    expect(visibleUserTexts(result.current.messages)).not.toContain(SEND_PAYLOAD.text)
    const optimistic = useOptimisticUserMessageStore.getState().messagesBySessionId.get(SESSION_ID)
    expect(visibleUserTexts(optimistic ?? [])).not.toContain(SEND_PAYLOAD.text)
  })

  it('leaves no first-send recovery behind for a refused first message', async () => {
    apiMock.sendMessage.mockResolvedValueOnce({
      outcome: 'refused',
      message: 'host_run_ceiling_reached',
      code: 'host_run_ceiling_reached',
    })
    const emptySession = createSessionWithIdAndMessages(SESSION_ID, 1, [])
    const { result } = renderHook(() => useAgentChat(SESSION_ID, emptySession, MODEL))

    await act(async () => {
      await result.current.sendMessage(SEND_PAYLOAD).catch(() => undefined)
    })

    // Recorded before the send, then cleared: a restart must not offer Retry for this message.
    const recoveries = firstSendRecoveryCalls.filter(([id]) => id === SESSION_ID)
    expect(recoveries.at(0)?.[1]).toMatchObject({ payload: SEND_PAYLOAD })
    expect(recoveries.at(-1)?.[1]).toBeNull()
  })

  it('leaves a later send on screen when an earlier send’s refusal arrives after Stop', async () => {
    const earlier = createDeferred<AgentSendReport>()
    const later = createDeferred<AgentSendReport>()
    apiMock.sendMessage.mockImplementationOnce(() => earlier.promise)
    apiMock.sendMessage.mockImplementationOnce(() => later.promise)
    const { result } = renderHook(() => useAgentChat(SESSION_ID, createSession(), MODEL))

    await act(async () => {
      void result.current.sendMessage(SEND_PAYLOAD).catch(() => undefined)
    })
    await act(async () => {
      result.current.stop()
    })
    await act(async () => {
      void result.current.sendMessage({ ...SEND_PAYLOAD, text: 'Later.' }).catch(() => undefined)
    })
    expect(result.current.status).toBe('submitted')

    await act(async () => {
      earlier.resolve({
        outcome: 'refused',
        message: 'queue_capacity_reached',
        code: 'queue_capacity_reached',
      })
    })

    // The later send still owns the Session: it is still waiting for its Run.
    expect(result.current.status).toBe('submitted')
    expect(result.current.isLoading).toBe(true)
    later.resolve({ outcome: 'queued' })
  })

  it('shows no error of its own when its Run failed before the Host refused it', async () => {
    clearLastAgentErrorInfo(SESSION_ID)
    const { result } = renderHook(() => useAgentChat(SESSION_ID, createSession(), MODEL))

    await refuseAfterOwnFailure(result)

    // The composer says why; an error banner here would offer Retry for the message before it.
    expect(result.current.error).toBeUndefined()
    expect(result.current.status).toBe('ready')
    expect(visibleUserTexts(result.current.messages)).not.toContain(SEND_PAYLOAD.text)
    expect(getLastAgentErrorInfo(SESSION_ID)).toBeNull()
  })

  it('puts back the earlier error’s banner details, not the refused Run’s', async () => {
    setLastAgentErrorInfo(SESSION_ID, { message: 'Rate limited by the provider' })
    const earlier = getLastAgentErrorInfo(SESSION_ID)
    const { result } = renderHook(() => useAgentChat(SESSION_ID, createSession(), MODEL))

    await refuseAfterOwnFailure(result)

    // The banner reads its text from the stored details, which the refused Run overwrote.
    expect(getLastAgentErrorInfo(SESSION_ID)).toEqual(earlier)
  })
})
