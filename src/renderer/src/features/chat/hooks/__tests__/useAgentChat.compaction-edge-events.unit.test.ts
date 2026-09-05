// @vitest-environment jsdom

import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { IpcEventChannelMap } from '@shared/types/ipc-events'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  createSession,
  emitAgentEvent,
  installUseAgentChatTestLifecycle,
  useAgentChat,
} from './useAgentChat.test-utils'

const SESSION_ID = SessionId('session-1')
type AgentTransportEvent = IpcEventChannelMap['agent:event']['payload']['event']

function renderAgentChat() {
  return renderHook(() =>
    useAgentChat(SESSION_ID, createSession(), SupportedModelId('claude-sonnet-4-5'), 'medium'),
  )
}

function emit(event: AgentTransportEvent) {
  emitAgentEvent({ sessionId: SESSION_ID, event })
}

function start(reason: 'manual' | 'threshold' = 'threshold', timestamp = 1) {
  emit({ type: 'compaction_start', reason, timestamp })
}

function end(timestamp: number, options: { aborted?: boolean; errorMessage?: string } = {}) {
  emit({
    type: 'compaction_end',
    reason: 'threshold',
    result: options.aborted || options.errorMessage ? null : {},
    aborted: options.aborted ?? false,
    willRetry: false,
    errorMessage: options.errorMessage,
    timestamp,
  })
}

describe('useAgentChat compaction event edges', () => {
  installUseAgentChatTestLifecycle()

  it('appends a missed-start completion after a cached completed item', async () => {
    const { result } = renderAgentChat()
    await act(async () => {
      start('threshold', 1)
      end(2)
      end(3)
    })

    expect(result.current.compactionStatus).toMatchObject({
      type: 'completed',
      timeline: [
        { id: '1:0', phase: 'completed', expectedSummaryCount: 1 },
        { id: '3:0', phase: 'completed', expectedSummaryCount: 2 },
      ],
    })
  })

  it('keeps a compaction completed during retry when the retry ends', async () => {
    const { result } = renderAgentChat()
    await act(async () => {
      emit({
        type: 'auto_retry_start',
        attempt: 1,
        maxAttempts: 3,
        delayMs: 100,
        errorMessage: 'temporary',
        timestamp: 1,
      })
      start('threshold', 2)
      end(3)
      emit({ type: 'auto_retry_end', success: true, attempt: 1, timestamp: 4 })
    })

    expect(result.current.compactionStatus).toMatchObject({
      type: 'completed',
      timeline: [{ id: '2:0', phase: 'completed' }],
    })
  })

  it('retains an earlier completion when a later compaction is aborted or fails', async () => {
    const { result } = renderAgentChat()
    await act(async () => {
      start('threshold', 1)
      end(2)
      start('threshold', 3)
      end(4, { aborted: true })
    })
    expect(result.current.compactionStatus).toMatchObject({
      suppressAnnouncement: true,
      timeline: [{ id: '1:0', phase: 'completed' }],
    })

    await act(async () => {
      start('threshold', 5)
      end(6, { errorMessage: 'Compaction failed' })
    })
    expect(result.current.compactionStatus).toMatchObject({
      suppressAnnouncement: true,
      timeline: [{ id: '1:0', phase: 'completed' }],
    })
  })
})
