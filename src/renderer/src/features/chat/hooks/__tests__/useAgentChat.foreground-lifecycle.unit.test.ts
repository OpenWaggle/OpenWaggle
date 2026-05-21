// @vitest-environment jsdom

import { SessionId, SupportedModelId } from '@shared/types/brand'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  apiMock,
  createSession,
  emitAgentEvent,
  installUseAgentChatTestLifecycle,
  SEND_PAYLOAD,
  useAgentChat,
} from './useAgentChat.test-utils'

describe('useAgentChat foreground lifecycle', () => {
  installUseAgentChatTestLifecycle()
  it('settles a foreground send when the run is steered', async () => {
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
      await result.current.steer()
      await sendPromise
    })

    expect(apiMock.steerAgent).toHaveBeenCalledWith(SessionId('session-1'))
    expect(result.current.status).toBe('ready')
  })

  it('surfaces compaction lifecycle events as foreground activity', async () => {
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
          type: 'compaction_start',
          reason: 'manual',
          timestamp: 1,
        },
      })
    })

    expect(result.current.status).toBe('compacting')
    expect(result.current.isLoading).toBe(true)
    expect(result.current.compactionStatus).toEqual({ type: 'compacting', reason: 'manual' })

    await act(async () => {
      emitAgentEvent({
        sessionId: SessionId('session-1'),
        event: {
          type: 'compaction_end',
          reason: 'manual',
          result: {
            summary: 'Kept the active task context.',
            firstKeptEntryId: 'kept-user',
            tokensBefore: 123456,
          },
          aborted: false,
          willRetry: false,
          timestamp: 2,
        },
      })
    })

    expect(result.current.status).toBe('ready')
    expect(result.current.isLoading).toBe(false)
    expect(result.current.compactionStatus).toBeNull()
  })
})
