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

function deferredPromise() {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

describe('useSteerWorkflow', () => {
  beforeEach(() => {
    useMessageQueueStore.setState({ queues: new Map() })
  })

  it('hands an explicit steer to main during compaction and keeps its preview pending', async () => {
    useMessageQueueStore.getState().enqueue(SESSION_ID, PAYLOAD)
    const queued = useMessageQueueStore.getState().queues.get(SESSION_ID)?.[0]
    if (!queued) throw new Error('Expected queued message')
    const setup = createDeps(true)
    const delivery = deferredPromise()
    setup.deps.steer.mockReturnValueOnce(delivery.promise)
    const { result, rerender } = renderHook(
      ({ isCompacting }) =>
        useSteerWorkflow({
          ...setup.deps,
          isCompacting,
        }),
      { initialProps: { isCompacting: true } },
    )

    let steerPromise!: Promise<void>
    act(() => {
      steerPromise = result.current.handleSteer(queued.id)
    })

    expect(useMessageQueueStore.getState().queues.get(SESSION_ID) ?? []).toHaveLength(0)
    expect(setup.deps.previewSteeredUserTurn).toHaveBeenCalledWith(
      PAYLOAD,
      'waiting-for-compaction',
    )
    expect(setup.deps.steer).toHaveBeenCalledWith(PAYLOAD)
    expect(result.current.isSteering).toBe(true)

    rerender({ isCompacting: false })

    await act(async () => {
      delivery.resolve()
      await steerPromise
    })
    await waitFor(() => expect(setup.preview.setDeliveryState).toHaveBeenCalledWith('sending'))
    expect(result.current.isSteering).toBe(false)
  })

  it('does not lose an in-flight steer when the chat surface unmounts', async () => {
    useMessageQueueStore.getState().enqueue(SESSION_ID, PAYLOAD)
    const queued = useMessageQueueStore.getState().queues.get(SESSION_ID)?.[0]
    if (!queued) throw new Error('Expected queued message')
    const setup = createDeps(true)
    const delivery = deferredPromise()
    setup.deps.steer.mockReturnValueOnce(delivery.promise)
    const { result, unmount } = renderHook(() => useSteerWorkflow(setup.deps))

    let steerPromise!: Promise<void>
    act(() => {
      steerPromise = result.current.handleSteer(queued.id)
    })
    unmount()

    expect(setup.deps.steer).toHaveBeenCalledWith(PAYLOAD)
    await act(async () => {
      delivery.resolve()
      await steerPromise
    })
    expect(useMessageQueueStore.getState().queues.get(SESSION_ID) ?? []).toHaveLength(0)
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

  it('restores the exact queued message at its original position when native steer fails', async () => {
    const before = { ...PAYLOAD, text: 'before' }
    const after = { ...PAYLOAD, text: 'after' }
    useMessageQueueStore.getState().enqueue(SESSION_ID, before)
    useMessageQueueStore.getState().enqueue(SESSION_ID, PAYLOAD)
    useMessageQueueStore.getState().enqueue(SESSION_ID, after)
    const original = useMessageQueueStore.getState().queues.get(SESSION_ID)
    const queued = original?.[1]
    if (!queued) throw new Error('Expected queued message')
    const setup = createDeps(false)
    setup.deps.steer.mockRejectedValueOnce(new Error('steer unavailable'))
    const { result } = renderHook(() => useSteerWorkflow(setup.deps))

    await act(async () => {
      await result.current.handleSteer(queued.id)
    })

    expect(setup.preview.clear).toHaveBeenCalledOnce()
    expect(useMessageQueueStore.getState().queues.get(SESSION_ID)).toEqual(original)
    expect(setup.deps.showToast).toHaveBeenCalled()
  })
})
