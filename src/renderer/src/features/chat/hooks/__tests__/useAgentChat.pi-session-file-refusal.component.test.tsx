import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MessageNotDelivered } from '../../lib/message-delivery'
import { useOptimisticUserMessageStore } from '../../state/optimistic-user-message-store'
import {
  createSession,
  emitAgentEvent,
  emitRunCompleted,
  installUseAgentChatTestLifecycle,
  SEND_PAYLOAD,
  useAgentChat,
} from './useAgentChat.test-utils'

const SESSION_ID = SessionId('session-deleted-file')
const MODEL = SupportedModelId('openrouter/anthropic/claude-haiku-4.5')
const REFUSAL =
  'This Session\'s Pi session file was deleted outside OpenWaggle (/p/s.jsonl), so its history is gone and it cannot be continued. Restore the file to continue it. The Session stays, to read, because fork "Notes (copy)" still depends on it.'

function visibleUserTexts(messages: readonly UIMessage[]) {
  return messages
    .filter((message) => message.role === 'user')
    .flatMap((message) =>
      message.parts.flatMap((part) => (part.type === 'text' ? [part.content] : [])),
    )
}

function refuseRun(runId: string) {
  // The Host refuses the Run before it reaches Pi, as it does for a Session whose Pi file is gone.
  emitAgentEvent({
    sessionId: SESSION_ID,
    event: { type: 'agent_end', runId, reason: 'error', error: { message: REFUSAL }, timestamp: 1 },
  })
  emitRunCompleted({ sessionId: SESSION_ID })
}

/*
 * A send to a Session whose Pi file was deleted is refused before the agent gets it. The message
 * was never delivered, so it leaves the transcript and goes back to the caller as undelivered, and
 * the Session's own notice is the one place that explains why: no error card repeats it.
 */
describe('useAgentChat send refused because the Pi session file cannot be used', () => {
  installUseAgentChatTestLifecycle()

  it('drops the optimistic message, shows no error, and reports it undelivered', async () => {
    const { result } = renderHook(() => useAgentChat(SESSION_ID, createSession(), MODEL))

    let outcome: unknown = 'pending'
    await act(async () => {
      void result.current.sendMessage(SEND_PAYLOAD).catch((error: unknown) => {
        outcome = error
      })
    })
    expect(visibleUserTexts(result.current.messages)).toContain(SEND_PAYLOAD.text)
    await act(async () => {
      refuseRun('run-refused')
    })

    expect(outcome).toBeInstanceOf(MessageNotDelivered)
    expect(outcome).toMatchObject({ outcome: 'refused', message: REFUSAL })
    expect(result.current.error).toBeUndefined()
    expect(result.current.status).toBe('ready')
    expect(result.current.isLoading).toBe(false)
    expect(visibleUserTexts(result.current.messages)).not.toContain(SEND_PAYLOAD.text)
    const optimistic = useOptimisticUserMessageStore.getState().messagesBySessionId.get(SESSION_ID)
    expect(visibleUserTexts(optimistic ?? [])).not.toContain(SEND_PAYLOAD.text)
  })
})
