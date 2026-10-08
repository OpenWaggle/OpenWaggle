// @vitest-environment jsdom

import { SessionId, SupportedModelId } from '@shared/types/brand'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  apiMock,
  createSession,
  emitAgentEvent,
  emitRunCompleted,
  installUseAgentChatTestLifecycle,
  SEND_PAYLOAD,
  useAgentChat,
} from './useAgentChat.test-utils'

const SESSION_ID = SessionId('session-1')
const MODEL = SupportedModelId('claude-sonnet-4-5')

/*
 * A Waggle the agent requests streams as `waggle-of-<X>` and settles as the classic Run X. A
 * settlement named by the Waggle's id (as a bridge once made one up) still settles the send of X.
 */
describe('useAgentChat settling the Run behind a requested Waggle', () => {
  installUseAgentChatTestLifecycle()

  it('settles the send of the classic Run however its settlement names it', async () => {
    const { result } = renderHook(() => useAgentChat(SESSION_ID, createSession(), MODEL))
    apiMock.sendMessage.mockResolvedValueOnce({ outcome: 'delivered', runId: 'run-X' })
    let send: Promise<void> | null = null
    await act(async () => {
      send = result.current.sendMessage(SEND_PAYLOAD)
    })
    await act(async () => {
      emitAgentEvent({
        sessionId: SESSION_ID,
        event: { type: 'agent_start', runId: 'waggle-of-run-X', timestamp: 2 },
      })
      emitRunCompleted({ sessionId: SESSION_ID, runId: 'waggle-of-run-X' })
      await send
    })
    expect(result.current.status).toBe('ready')
  })
})
