import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { IpcEventPayload } from '@shared/types/ipc'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useContextUsageSnapshot } from '../useContextUsageSnapshot'

type AgentEventHandler = (payload: IpcEventPayload<'agent:event'>) => void

const ipcMocks = vi.hoisted(() => ({
  getContextUsage: vi.fn(),
  onAgentEvent: vi.fn<(callback: AgentEventHandler) => () => void>(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api: ipcMocks }))

const SESSION_ID = SessionId('session-1')
const MODEL_ID = SupportedModelId('openai/gpt-5.4')

describe('useContextUsageSnapshot', () => {
  beforeEach(() => {
    ipcMocks.getContextUsage.mockReset()
    ipcMocks.getContextUsage.mockResolvedValue({
      tokens: 10_000,
      contextWindow: 100_000,
      percent: 10,
    })
    ipcMocks.onAgentEvent.mockReset()
    ipcMocks.onAgentEvent.mockReturnValue(() => {})
  })

  it('updates during a running turn when Pi reports completed-response usage', async () => {
    const { result } = renderHook(() =>
      useContextUsageSnapshot({
        activeSessionId: SESSION_ID,
        selectedModel: MODEL_ID,
        requestKey: 'session-1:openai/gpt-5.4:v1',
      }),
    )

    await waitFor(() => expect(result.current.snapshot?.tokens).toBe(10_000))
    const handler = ipcMocks.onAgentEvent.mock.calls[0]?.[0]
    if (!handler) throw new Error('Expected context meter event subscription')

    act(() => {
      handler({
        sessionId: SESSION_ID,
        event: {
          type: 'context_usage',
          tokens: 26_000,
          contextWindow: 100_000,
          timestamp: 1,
          model: MODEL_ID,
        },
      })
    })

    expect(result.current.snapshot).toEqual({
      tokens: 26_000,
      contextWindow: 100_000,
      percent: 26,
    })
  })

  it('ignores late usage from a model the user switched away from', async () => {
    const { result } = renderHook(() =>
      useContextUsageSnapshot({
        activeSessionId: SESSION_ID,
        selectedModel: MODEL_ID,
        requestKey: 'session-1:openai/gpt-5.4:v1',
      }),
    )

    await waitFor(() => expect(result.current.snapshot?.tokens).toBe(10_000))
    const handler = ipcMocks.onAgentEvent.mock.calls[0]?.[0]
    if (!handler) throw new Error('Expected context meter event subscription')

    act(() => {
      handler({
        sessionId: SESSION_ID,
        event: {
          type: 'context_usage',
          tokens: 99_000,
          contextWindow: 100_000,
          timestamp: 1,
          model: SupportedModelId('anthropic/claude-sonnet-4-6'),
        },
      })
    })

    expect(result.current.snapshot?.tokens).toBe(10_000)
  })

  it('marks usage unknown immediately after successful compaction', async () => {
    const { result } = renderHook(() =>
      useContextUsageSnapshot({
        activeSessionId: SESSION_ID,
        selectedModel: MODEL_ID,
        requestKey: 'session-1:openai/gpt-5.4:v1',
      }),
    )

    await waitFor(() => expect(result.current.snapshot?.tokens).toBe(10_000))
    const handler = ipcMocks.onAgentEvent.mock.calls[0]?.[0]
    if (!handler) throw new Error('Expected context meter event subscription')

    act(() => {
      handler({
        sessionId: SESSION_ID,
        event: {
          type: 'compaction_end',
          reason: 'threshold',
          result: {
            summary: 'Compacted context',
            firstKeptEntryId: 'kept-entry',
            tokensBefore: 80_000,
          },
          aborted: false,
          willRetry: false,
          timestamp: 1,
          model: MODEL_ID,
        },
      })
    })

    expect(result.current.snapshot).toEqual({
      tokens: null,
      contextWindow: 100_000,
      percent: null,
    })
  })
})
