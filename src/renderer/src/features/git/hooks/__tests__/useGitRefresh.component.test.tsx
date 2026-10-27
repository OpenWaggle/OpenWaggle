import { RepositoryPath, SessionId, WorkingPath } from '@shared/types/brand'
import type { IpcEventPayload } from '@shared/types/ipc'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type AgentEventPayload = IpcEventPayload<'agent:event'>

const bridge = vi.hoisted(() => {
  const state: { agentEvent: ((payload: AgentEventPayload) => void) | null } = {
    agentEvent: null,
  }
  return state
})

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    onAgentEvent: (callback: (payload: AgentEventPayload) => void) => {
      bridge.agentEvent = callback
      return () => {
        bridge.agentEvent = null
      }
    },
    onGitWorkingTreeChanged: () => () => {},
  },
}))

import { useGitRefresh } from '../useGitRefresh'

const REFRESH_DELAY_MS = 500

describe('useGitRefresh', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('refreshes git once a Run ends, and leaves the transcript to the settlement', () => {
    const refreshGitStatus = vi.fn(async () => {})
    const refreshGitBranches = vi.fn(async () => {})
    renderHook(() =>
      useGitRefresh({
        workingPath: WorkingPath('/repo'),
        repositoryPath: RepositoryPath('/repo'),
        refreshGitStatus,
        refreshGitBranches,
      }),
    )

    act(() =>
      bridge.agentEvent?.({
        sessionId: SessionId('session-1'),
        event: { type: 'agent_end', runId: 'run-1', reason: 'stop', timestamp: 1 },
      }),
    )
    act(() => vi.advanceTimersByTime(REFRESH_DELAY_MS))

    expect(refreshGitStatus).toHaveBeenCalledWith('/repo')
    expect(refreshGitBranches).toHaveBeenCalledWith('/repo')
  })
})
