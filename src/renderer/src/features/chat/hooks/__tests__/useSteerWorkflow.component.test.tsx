import { SessionId } from '@shared/types/brand'
import type { SessionControlSteeringReceipt } from '@shared/types/session-control'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useOptimisticSteerStore } from '../../state/optimistic-steer-store'
import { useSteerWorkflow } from '../useSteerWorkflow'

function deferred() {
  let resolve: (receipt?: SessionControlSteeringReceipt) => void = () => {
    throw new Error('Not initialized')
  }
  const promise = new Promise<SessionControlSteeringReceipt>((settle) => {
    resolve = (
      receipt = { delivery: 'queued', durableTextSha256: 'a'.repeat(64), minimumCreatedOrder: 1 },
    ) => settle(receipt)
  })
  return { promise, resolve }
}

function setup() {
  return {
    activeSessionId: SessionId('session-1'),
    followUps: ['follow-up-1', 'follow-up-2', 'first', 'second'].map((id) => ({
      id,
      text: `Text for ${id}`,
      attachmentCount: 0,
      createdAt: 1,
      deliveryState: 'pending' as const,
    })),
    isCompacting: true,
    previewSteeredUserTurn: vi.fn(() => ({
      clear: vi.fn(),
      setDurableContent: vi.fn(),
      setReceipt: vi.fn(),
      setDeliveryState: vi.fn(),
    })),
    promoteFollowUp: vi.fn(
      async (_id: string): Promise<SessionControlSteeringReceipt> => ({
        delivery: 'queued',
        durableTextSha256: 'a'.repeat(64),
        minimumCreatedOrder: 1,
      }),
    ),
    withDeferredSnapshotRefresh: <T,>(operation: () => Promise<T>) => operation(),
    showToast: vi.fn(),
  }
}

describe('useSteerWorkflow with the durable Host queue', () => {
  beforeEach(() => {
    useOptimisticSteerStore.setState({ pendingPromotions: new Map() })
  })

  it('previews a pending promotion without withdrawing its durable queue item', async () => {
    const deps = setup()
    const gate = deferred()
    deps.promoteFollowUp.mockReturnValueOnce(gate.promise)
    const { result } = renderHook(() => useSteerWorkflow(deps))
    let operation: Promise<void> | undefined
    act(() => {
      operation = result.current.handleSteer('follow-up-2')
    })
    expect(deps.previewSteeredUserTurn).toHaveBeenCalledWith(
      { text: 'Text for follow-up-2', attachments: [], thinkingLevel: 'off' },
      'waiting-for-compaction',
    )
    expect(useOptimisticSteerStore.getState().pendingPromotions.get(deps.activeSessionId)).toEqual([
      'follow-up-2',
    ])
    expect(deps.followUps).toHaveLength(4)
    const preview = deps.previewSteeredUserTurn.mock.results[0]?.value
    expect(preview?.clear).not.toHaveBeenCalled()
    await act(async () => {
      gate.resolve()
      await operation
    })
    expect(preview?.clear).not.toHaveBeenCalled()
    expect(preview?.setReceipt).toHaveBeenLastCalledWith({
      delivery: 'queued',
      durableTextSha256: 'a'.repeat(64),
      minimumCreatedOrder: 1,
    })
    expect(preview?.setDeliveryState).toHaveBeenCalledWith('sending')
    expect(useOptimisticSteerStore.getState().pendingPromotions.has(deps.activeSessionId)).toBe(
      false,
    )
  })

  it('clears the preview for a handled extension command that produces no user node', async () => {
    const deps = setup()
    deps.promoteFollowUp.mockResolvedValueOnce({ delivery: 'handled' })
    const { result } = renderHook(() => useSteerWorkflow(deps))
    await act(() => result.current.handleSteer('follow-up-1'))
    expect(deps.previewSteeredUserTurn.mock.results[0]?.value.clear).toHaveBeenCalledOnce()
  })

  it('does not infer delivery from a historical success without a recorded receipt', async () => {
    const deps = setup()
    deps.promoteFollowUp.mockResolvedValueOnce({ delivery: 'unavailable' })
    const { result } = renderHook(() => useSteerWorkflow(deps))
    await act(() => result.current.handleSteer('follow-up-1'))
    const preview = deps.previewSteeredUserTurn.mock.results[0]?.value
    expect(preview?.clear).not.toHaveBeenCalled()
    expect(preview?.setReceipt).toHaveBeenCalledExactlyOnceWith(null)
    expect(preview?.setDeliveryState).toHaveBeenCalledWith('sending')
  })

  it('restores local queue visibility and clears the preview on Host refusal', async () => {
    const deps = setup()
    deps.promoteFollowUp.mockRejectedValueOnce(new Error('Run ended'))
    const { result } = renderHook(() => useSteerWorkflow(deps))
    await act(() => result.current.handleSteer('follow-up-1'))
    expect(deps.previewSteeredUserTurn.mock.results[0]?.value.clear).toHaveBeenCalledOnce()
    expect(useOptimisticSteerStore.getState().pendingPromotions.has(deps.activeSessionId)).toBe(
      false,
    )
    expect(deps.followUps).toHaveLength(4)
  })

  it('deduplicates clicks and keeps pending visibility scoped to the originating Session', async () => {
    const deps = setup()
    const gate = deferred()
    deps.promoteFollowUp.mockReturnValueOnce(gate.promise)
    const { result, rerender } = renderHook(
      ({ sessionId }) => useSteerWorkflow({ ...deps, activeSessionId: sessionId }),
      { initialProps: { sessionId: deps.activeSessionId } },
    )
    let operation: Promise<void> | undefined
    act(() => {
      operation = result.current.handleSteer('follow-up-1')
      void result.current.handleSteer('follow-up-1')
    })
    expect(deps.promoteFollowUp).toHaveBeenCalledOnce()
    rerender({ sessionId: SessionId('other-session') })
    expect(result.current.isSteering).toBe(false)
    await act(async () => {
      gate.resolve()
      await operation
    })
    expect(useOptimisticSteerStore.getState().pendingPromotions.size).toBe(0)
  })

  it('promotes the selected Follow-up through Session Control without copying its payload', async () => {
    const deps = setup()
    const gate = deferred()
    deps.promoteFollowUp.mockReturnValueOnce(gate.promise)
    const { result } = renderHook(() => useSteerWorkflow(deps))
    let operation: Promise<void> | undefined
    act(() => {
      operation = result.current.handleSteer('follow-up-2')
    })
    expect(deps.promoteFollowUp).toHaveBeenCalledWith('follow-up-2')
    expect(result.current.isSteering).toBe(true)
    await act(async () => {
      gate.resolve()
      await operation
    })
    expect(result.current.isSteering).toBe(false)
  })

  it('keeps steering busy until every concurrent promotion settles', async () => {
    const deps = setup()
    const first = deferred()
    const second = deferred()
    deps.promoteFollowUp.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { result } = renderHook(() => useSteerWorkflow(deps))
    let firstOperation: Promise<void> | undefined
    let secondOperation: Promise<void> | undefined
    act(() => {
      firstOperation = result.current.handleSteer('first')
      secondOperation = result.current.handleSteer('second')
    })
    await act(async () => {
      first.resolve()
      await firstOperation
    })
    expect(result.current.isSteering).toBe(true)
    await act(async () => {
      second.resolve()
      await secondOperation
    })
    expect(result.current.isSteering).toBe(false)
  })

  it('reports a refused promotion and leaves queue ownership with the Host', async () => {
    const deps = setup()
    deps.promoteFollowUp.mockRejectedValueOnce(new Error('Run ended'))
    const { result } = renderHook(() => useSteerWorkflow(deps))
    await act(() => result.current.handleSteer('follow-up-1'))
    expect(deps.showToast).toHaveBeenCalledWith(expect.stringContaining('Could not steer'))
    expect(result.current.isSteering).toBe(false)
  })

  it('does not cancel an accepted promotion when the user navigates away', async () => {
    const deps = setup()
    const gate = deferred()
    deps.promoteFollowUp.mockReturnValueOnce(gate.promise)
    const { result, unmount } = renderHook(() => useSteerWorkflow(deps))
    let operation: Promise<void> | undefined
    act(() => {
      operation = result.current.handleSteer('follow-up-1')
    })
    unmount()
    gate.resolve()
    await expect(operation).resolves.toBeUndefined()
    expect(deps.promoteFollowUp).toHaveBeenCalledTimes(1)
  })

  it('does nothing when no Session is selected', async () => {
    const deps = setup()
    const { result } = renderHook(() => useSteerWorkflow({ ...deps, activeSessionId: null }))
    await act(() => result.current.handleSteer('follow-up-1'))
    expect(deps.promoteFollowUp).not.toHaveBeenCalled()
  })
})
