import { SessionId } from '@shared/types/brand'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const taskRuntimeMocks = vi.hoisted(() => ({
  broadcast: vi.fn(),
  runAppEffect: vi.fn(),
}))

vi.mock('../application/agent-run-service', () => ({ executeAgentRun: vi.fn() }))
vi.mock('../runtime', () => ({ runAppEffect: taskRuntimeMocks.runAppEffect }))
vi.mock('../utils/broadcast', () => ({ broadcastToWindows: taskRuntimeMocks.broadcast }))

import { defaultTaskServices } from '../openwaggle-mcp-task-runtime'

describe('default hosted-task runtime services', () => {
  beforeEach(() => {
    taskRuntimeMocks.broadcast.mockReset()
    taskRuntimeMocks.runAppEffect.mockReset().mockResolvedValue(undefined)
  })

  it('invalidates session summaries after lineage and delegation writes', async () => {
    await defaultTaskServices.establishLineage({
      sessionId: SessionId('worker-session'),
      parentSessionId: SessionId('parent-session'),
      agentDefinitionName: null,
      delegationState: 'working',
    })
    await defaultTaskServices.setDelegationState(SessionId('worker-session'), 'accepted')

    expect(taskRuntimeMocks.broadcast).toHaveBeenNthCalledWith(1, 'sessions:list-invalidated', {
      sessionIds: [SessionId('parent-session'), SessionId('worker-session')],
    })
    expect(taskRuntimeMocks.broadcast).toHaveBeenNthCalledWith(2, 'sessions:list-invalidated', {
      sessionIds: [SessionId('worker-session')],
    })
  })

  it('does not invalidate summaries when the persistence write fails', async () => {
    taskRuntimeMocks.runAppEffect.mockRejectedValueOnce(new Error('database unavailable'))

    await expect(
      defaultTaskServices.setDelegationState(SessionId('worker-session'), 'accepted'),
    ).rejects.toThrow('database unavailable')

    expect(taskRuntimeMocks.broadcast).not.toHaveBeenCalled()
  })
})
