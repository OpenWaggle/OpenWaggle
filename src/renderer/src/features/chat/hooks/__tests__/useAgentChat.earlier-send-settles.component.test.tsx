import type { AgentSendReport } from '@shared/types/agent'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useForegroundSendStore } from '../../state/foreground-send-store'
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

  // Switching away stops following Session A, so its earlier send settles with the newer one;
  // left pending, A's send count stayed up and its pickers stayed locked.
  it('settles the earlier send when the person switches away', async () => {
    const other = SessionId('session-other')
    apiMock.sendMessage
      .mockResolvedValueOnce({ outcome: 'delivered', runId: 'run-1' })
      .mockReturnValueOnce(new Promise<AgentSendReport>(() => {}))
    useForegroundSendStore.setState({ counts: new Map() })
    const { result, rerender } = renderHook(
      ({ id }) => useAgentChat(id, createSessionWithId(id), MODEL),
      { initialProps: { id: SESSION_ID } },
    )
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
    await act(async () => {
      void result.current
        .sendMessage({ ...SEND_PAYLOAD, text: 'A later message' })
        .catch(() => undefined)
    })
    await act(async () => {
      rerender({ id: other })
    })

    expect(earlier).toBe('resolved')
  })

  // The earlier Run's completion lands on the newer send before it knows its Run; it is held,
  // and the foreground state is cleared while the newer send is still in flight. Switching
  // away must still settle that send, or the Session's send count stays up.
  it('settles a newer send that held an earlier completion when the person switches away', async () => {
    const other = SessionId('session-other')
    let resolveLater: (report: AgentSendReport) => void = () => {}
    apiMock.sendMessage
      .mockResolvedValueOnce({ outcome: 'delivered', runId: 'run-1' })
      .mockReturnValueOnce(
        new Promise<AgentSendReport>((resolve) => {
          resolveLater = resolve
        }),
      )
    useForegroundSendStore.setState({ counts: new Map() })
    const { result, rerender } = renderHook(
      ({ id }) => useAgentChat(id, createSessionWithId(id), MODEL),
      { initialProps: { id: SESSION_ID } },
    )
    await act(async () => {
      void result.current.sendMessage(SEND_PAYLOAD).catch(() => undefined)
    })
    await act(async () => {
      emitAgentEvent({
        sessionId: SESSION_ID,
        event: { type: 'agent_start', runId: 'run-1', timestamp: 1 },
      })
      emitAgentEvent({
        sessionId: SESSION_ID,
        event: { type: 'agent_end', runId: 'run-1', reason: 'stop', timestamp: 2 },
      })
    })
    let newer = 'pending'
    await act(async () => {
      void result.current.sendMessage({ ...SEND_PAYLOAD, text: 'A later message' }).then(
        () => {
          newer = 'resolved'
        },
        () => {
          newer = 'rejected'
        },
      )
    })
    await act(async () => {
      emitRunCompleted({ sessionId: SESSION_ID, runId: 'run-1' })
    })
    await act(async () => {
      resolveLater({ outcome: 'delivered', runId: 'run-2' })
    })
    await act(async () => {
      emitAgentEvent({
        sessionId: SESSION_ID,
        event: { type: 'agent_start', runId: 'run-2', timestamp: 3 },
      })
    })
    await act(async () => {
      rerender({ id: other })
    })

    expect(newer).toBe('resolved')
    expect(useForegroundSendStore.getState().counts.get(SESSION_ID)).toBeUndefined()
  })
})
