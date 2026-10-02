import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  getWorkspaceLifecycleMocks,
  loadUseWorkspaceLifecycle,
  resetWorkspaceLifecycleMocks,
} from './useWorkspaceLifecycle.test-harness'

const lifecycleMocks = getWorkspaceLifecycleMocks()

describe("useWorkspaceLifecycle and Pi's default thinking level", () => {
  let useWorkspaceLifecycle: Awaited<
    ReturnType<typeof loadUseWorkspaceLifecycle>
  >['useWorkspaceLifecycle']

  beforeEach(async () => {
    resetWorkspaceLifecycleMocks()
    ;({ useWorkspaceLifecycle } = await loadUseWorkspaceLifecycle())
  })

  it("refreshes this window's draft thinking picker when another window changes the default", async () => {
    renderHook(() => useWorkspaceLifecycle())
    await waitFor(() => expect(lifecycleMocks.loadChatSessions).toHaveBeenCalledOnce())
    lifecycleMocks.invalidateQueries.mockClear()
    const eventHandler = lifecycleMocks.getSessionHostEventHandler()
    if (!eventHandler) throw new Error('Expected Session Host event subscription')

    act(() =>
      eventHandler({
        cursor: { hostInstanceId: 'host-default', sequence: 1 },
        timestamp: 1,
        payload: { kind: 'default-thinking-level-changed', level: 'high' },
      }),
    )

    expect(lifecycleMocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['pi-default-thinking-level'],
    })
    // A sessionless event refreshes no Session.
    expect(lifecycleMocks.refreshSession).not.toHaveBeenCalled()
  })
})
