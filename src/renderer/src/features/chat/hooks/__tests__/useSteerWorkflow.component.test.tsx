import { SessionId } from '@shared/types/brand'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useSteerWorkflow } from '../useSteerWorkflow'

function deferred() {
  let resolve: () => void = () => {
    throw new Error('Not initialized')
  }
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function setup() {
  return {
    activeSessionId: SessionId('session-1'),
    promoteFollowUp: vi.fn(async (_id: string): Promise<void> => undefined),
    withDeferredSnapshotRefresh: <T,>(operation: () => Promise<T>) => operation(),
    showToast: vi.fn(),
  }
}

describe('useSteerWorkflow with the durable Host queue', () => {
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
