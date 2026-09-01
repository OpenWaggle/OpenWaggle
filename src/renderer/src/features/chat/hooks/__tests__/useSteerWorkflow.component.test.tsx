// @vitest-environment jsdom

import type { AgentSendPayload } from '@shared/types/agent'
import { SessionId } from '@shared/types/brand'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMessageQueueStore } from '@/features/chat/state'
import { useSteerWorkflow } from '../useSteerWorkflow'

const SESSION_ID = SessionId('session-1')
const PAYLOAD: AgentSendPayload = {
  text: 'Continue with the implementation',
  thinkingLevel: 'medium',
  attachments: [],
}

function createDeps(isCompacting: boolean) {
  const preview = {
    clear: vi.fn(),
    setDeliveryState: vi.fn(),
  }
  async function withDeferredSnapshotRefresh<T>(operation: () => Promise<T>): Promise<T> {
    return operation()
  }
  return {
    deps: {
      activeSessionId: SESSION_ID,
      isCompacting,
      steer: vi.fn().mockResolvedValue(undefined),
      previewSteeredUserTurn: vi.fn().mockReturnValue(preview),
      withDeferredSnapshotRefresh,
      showToast: vi.fn(),
    },
    preview,
  }
}

describe('useSteerWorkflow', () => {
  beforeEach(() => {
    useMessageQueueStore.setState({ queues: new Map() })
  })

  it('previews an explicit steer during compaction and delivers it only after compaction', async () => {
    useMessageQueueStore.getState().enqueue(SESSION_ID, PAYLOAD)
    const queued = useMessageQueueStore.getState().queues.get(SESSION_ID)?.[0]
    if (!queued) throw new Error('Expected queued message')
    const setup = createDeps(true)
    const { result, rerender } = renderHook(
      ({ isCompacting }) =>
        useSteerWorkflow({
          ...setup.deps,
          isCompacting,
        }),
      { initialProps: { isCompacting: true } },
    )

    await act(async () => {
      await result.current.handleSteer(queued.id)
    })

    expect(useMessageQueueStore.getState().queues.get(SESSION_ID) ?? []).toHaveLength(0)
    expect(setup.deps.previewSteeredUserTurn).toHaveBeenCalledWith(
      PAYLOAD,
      'waiting-for-compaction',
    )
    expect(setup.deps.steer).not.toHaveBeenCalled()

    rerender({ isCompacting: false })

    await waitFor(() => expect(setup.deps.steer).toHaveBeenCalledWith(PAYLOAD))
    expect(setup.preview.setDeliveryState).toHaveBeenCalledWith('sending')
  })

  it('delivers an explicit steer immediately when compaction is not running', async () => {
    useMessageQueueStore.getState().enqueue(SESSION_ID, PAYLOAD)
    const queued = useMessageQueueStore.getState().queues.get(SESSION_ID)?.[0]
    if (!queued) throw new Error('Expected queued message')
    const setup = createDeps(false)
    const { result } = renderHook(() => useSteerWorkflow(setup.deps))

    await act(async () => {
      await result.current.handleSteer(queued.id)
    })

    expect(setup.deps.previewSteeredUserTurn).toHaveBeenCalledWith(PAYLOAD, 'sending')
    expect(setup.deps.steer).toHaveBeenCalledWith(PAYLOAD)
  })

  it('restores the queued message and clears its preview when native steer fails', async () => {
    useMessageQueueStore.getState().enqueue(SESSION_ID, PAYLOAD)
    const queued = useMessageQueueStore.getState().queues.get(SESSION_ID)?.[0]
    if (!queued) throw new Error('Expected queued message')
    const setup = createDeps(false)
    setup.deps.steer.mockRejectedValueOnce(new Error('steer unavailable'))
    const { result } = renderHook(() => useSteerWorkflow(setup.deps))

    await act(async () => {
      await result.current.handleSteer(queued.id)
    })

    expect(setup.preview.clear).toHaveBeenCalledOnce()
    expect(useMessageQueueStore.getState().queues.get(SESSION_ID)?.[0]?.payload).toEqual(PAYLOAD)
    expect(setup.deps.showToast).toHaveBeenCalled()
  })
})
