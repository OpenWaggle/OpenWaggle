import { MessageId, SessionId, SupportedModelId } from '@shared/types/brand'
import type { IpcEventChannelMap } from '@shared/types/ipc-events'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBackgroundRunStore } from '@/features/chat/state'
import { useSessionStatusMonitor } from '../useSessionStatusMonitor'

type RunCompletedHandler = (payload: IpcEventChannelMap['agent:run-completed']['payload']) => void

const monitorMocks = vi.hoisted(() => {
  let runCompletedHandler: RunCompletedHandler | null = null
  const subscribe = vi.fn(() => vi.fn())
  return {
    getRunCompletedHandler: () => runCompletedHandler,
    getSessionDetail: vi.fn(),
    onRunCompleted: vi.fn((handler: RunCompletedHandler) => {
      runCompletedHandler = handler
      return vi.fn()
    }),
    subscribe,
  }
})

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getSessionDetail: monitorMocks.getSessionDetail,
    onAgentEvent: monitorMocks.subscribe,
    onAgentPhase: monitorMocks.subscribe,
    onRunCompleted: monitorMocks.onRunCompleted,
    onWaggleTurnEvent: monitorMocks.subscribe,
    onWorktreeLaunch: monitorMocks.subscribe,
  },
}))

const SESSION_ID = SessionId('session-a')

describe('useSessionStatusMonitor', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.clearAllMocks()
    useBackgroundRunStore.setState({
      activeRunIds: new Set(),
      renderSnapshotsBySessionId: new Map(),
      worktreeLaunchBySessionId: new Map(),
      firstSendRecoveryBySessionId: new Map(),
    })
  })

  it('removes retained first-send contents after terminal durable delivery', async () => {
    monitorMocks.getSessionDetail.mockResolvedValue({
      id: SESSION_ID,
      title: 'Session A',
      projectPath: '/repo',
      messages: [
        {
          id: MessageId('message-a'),
          role: 'user',
          parts: [{ type: 'text', text: 'Delivered prompt' }],
          createdAt: 3,
        },
      ],
      createdAt: 1,
      updatedAt: 3,
      environmentMode: 'worktree',
    })
    useBackgroundRunStore.getState().setWorktreeLaunch(SESSION_ID, {
      status: 'complete',
      stage: 'starting-task',
      startedAt: 1,
      updatedAt: 2,
      details: ['Starting task'],
    })
    useBackgroundRunStore.getState().setFirstSendRecovery(SESSION_ID, {
      payload: { text: 'Retained prompt', thinkingLevel: 'medium', attachments: [] },
      waggleConfig: null,
      model: SupportedModelId('openai/gpt-5'),
    })
    renderHook(() => useSessionStatusMonitor())

    const handler = monitorMocks.getRunCompletedHandler()
    if (!handler) throw new Error('Expected run completion subscription')
    act(() => handler({ sessionId: SESSION_ID }))

    await waitFor(() => {
      expect(useBackgroundRunStore.getState().getWorktreeLaunch(SESSION_ID)).toBeNull()
      expect(useBackgroundRunStore.getState().firstSendRecoveryBySessionId.has(SESSION_ID)).toBe(
        false,
      )
    })
  })
})
