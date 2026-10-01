import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  getWorkspaceLifecycleMocks,
  loadUseWorkspaceLifecycle,
  resetWorkspaceLifecycleMocks,
} from './useWorkspaceLifecycle.test-harness'

const lifecycleMocks = getWorkspaceLifecycleMocks()

describe('useWorkspaceLifecycle Follow-up queue refresh', () => {
  let useWorkspaceLifecycle: Awaited<
    ReturnType<typeof loadUseWorkspaceLifecycle>
  >['useWorkspaceLifecycle']

  beforeEach(async () => {
    resetWorkspaceLifecycleMocks()
    ;({ useWorkspaceLifecycle } = await loadUseWorkspaceLifecycle())
  })

  it('refetches the Follow-up queue when a stopped Run settles, so returned steers reappear', async () => {
    renderHook(() => useWorkspaceLifecycle())
    await waitFor(() => expect(lifecycleMocks.loadChatSessions).toHaveBeenCalledOnce())
    lifecycleMocks.invalidateQueries.mockClear()

    const handler = lifecycleMocks.getSessionHostEventHandler()
    if (!handler) throw new Error('Expected Session Host event subscription')
    handler({
      cursor: { hostInstanceId: 'host-1', sequence: 10 },
      timestamp: 10,
      payload: {
        kind: 'session-state-changed',
        sessionId: 'session-1',
        stateRevision: 9,
        operation: 'run-settled',
        runId: 'run-stopped',
        terminalStatus: 'interrupted',
      },
    })

    await waitFor(() =>
      expect(lifecycleMocks.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['sessions', 'follow-up-queue', 'session-1'],
      }),
    )
  })
})
