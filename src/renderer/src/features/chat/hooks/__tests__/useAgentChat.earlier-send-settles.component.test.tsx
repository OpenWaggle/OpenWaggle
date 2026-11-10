import type { AgentSendReport } from '@shared/types/agent'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useForegroundSendStore } from '../../state/foreground-send-store'
import {
  apiMock,
  createSession,
  emitAgentEvent,
  emitRunCompleted,
  installUseAgentChatTestLifecycle,
  SEND_PAYLOAD,
  useAgentChat,
} from './useAgentChat.test-utils'

const SESSION_ID = SessionId('session-earlier-send')
const MODEL = SupportedModelId('openrouter/anthropic/claude-haiku-4.5')

type LaterEnd = 'fails' | 'cancelled' | 'stopped and fails' | 'stopped and cancelled'

/*
 * A send whose Run is still settling when the person sends again, and the newer send ends before
 * its invoke resolves. Only the newer send was settled, so the earlier send waited forever: its
 * caller never heard back and the Session's model and thinking pickers stayed locked.
 */
async function earlierSendAfter(end: LaterEnd) {
  let resolveLater: (report: AgentSendReport) => void = () => {}
  let failLater: (error: Error) => void = () => {}
  const later = new Promise<AgentSendReport>((resolve, reject) => {
    resolveLater = resolve
    failLater = reject
  })
  apiMock.sendMessage
    .mockResolvedValueOnce({ outcome: 'delivered', runId: 'run-1' })
    .mockReturnValueOnce(later)
  useForegroundSendStore.setState({ counts: new Map() })
  const { result } = renderHook(() => useAgentChat(SESSION_ID, createSession(), MODEL))
  let earlier = 'pending'
  await act(async () => {
    void result.current.sendMessage(SEND_PAYLOAD).then(
      () => {
        earlier = 'resolved'
      },
      () => {
        earlier = 'rejected'
      },
    )
  })
  await act(async () => {
    emitAgentEvent({
      sessionId: SESSION_ID,
      event: { type: 'agent_start', runId: 'run-1', timestamp: 1 },
    })
  })
  let laterSend: Promise<unknown> = Promise.resolve()
  await act(async () => {
    laterSend = result.current
      .sendMessage({ ...SEND_PAYLOAD, text: 'A later message' })
      .catch((error: unknown) => error)
  })
  if (end.startsWith('stopped')) {
    await act(async () => {
      result.current.stop()
    })
  }
  await act(async () => {
    if (end.endsWith('fails')) failLater(new Error('handler died'))
    else resolveLater({ outcome: 'cancelled', message: 'Stopped' })
    await laterSend
  })
  await act(async () => {
    emitRunCompleted({ sessionId: SESSION_ID, runId: 'run-1' })
  })
  return { earlier, count: useForegroundSendStore.getState().counts.get(SESSION_ID) }
}

describe('useAgentChat earlier send while a newer one ends without a Run', () => {
  installUseAgentChatTestLifecycle()

  it.each<LaterEnd>(['fails', 'cancelled', 'stopped and fails', 'stopped and cancelled'])(
    'settles the earlier send when the newer one %s',
    async (end) => {
      const { earlier, count } = await earlierSendAfter(end)

      expect(earlier).toBe('resolved')
      expect(count).toBeUndefined()
    },
  )
})
