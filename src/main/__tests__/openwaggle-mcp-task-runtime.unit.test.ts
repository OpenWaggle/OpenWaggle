import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const taskRuntimeMocks = vi.hoisted(() => ({
  broadcast: vi.fn(),
  captureSuccessfulRunResources: vi.fn(),
  executeAgentRun: vi.fn(),
  runAppEffect: vi.fn(),
}))

vi.mock('../application/agent-run-service', () => ({
  executeAgentRun: taskRuntimeMocks.executeAgentRun,
}))
vi.mock('../application/session-resource-capture', () => ({
  captureSuccessfulRunResources: taskRuntimeMocks.captureSuccessfulRunResources,
}))
vi.mock('../runtime', () => ({ runAppEffect: taskRuntimeMocks.runAppEffect }))
vi.mock('../utils/broadcast', () => ({ broadcastToWindows: taskRuntimeMocks.broadcast }))

import { defaultTaskServices } from '../openwaggle-mcp-task-runtime'

describe('default hosted-task runtime services', () => {
  beforeEach(() => {
    taskRuntimeMocks.broadcast.mockReset()
    taskRuntimeMocks.captureSuccessfulRunResources.mockReset().mockReturnValue(Effect.void)
    taskRuntimeMocks.executeAgentRun.mockReset()
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

  it('captures and invalidates resources after a successful hosted task run', async () => {
    const result = {
      outcome: 'success' as const,
      newMessages: [],
      resourceMessages: [],
      resourceNodeIds: {},
      resourceBranchIds: {},
    }
    taskRuntimeMocks.executeAgentRun.mockReturnValue(Effect.succeed(result))
    taskRuntimeMocks.runAppEffect.mockImplementation((program) => Effect.runPromise(program))

    await expect(
      defaultTaskServices.execute({
        sessionId: SessionId('reused-session'),
        runId: 'hosted-run',
        objective: 'Create an architecture image',
        thinkingLevel: 'medium',
        model: 'provider/model',
        signal: new AbortController().signal,
      }),
    ).resolves.toBe(result)

    expect(taskRuntimeMocks.captureSuccessfulRunResources).toHaveBeenCalledWith({
      sessionId: SessionId('reused-session'),
      runId: 'hosted-run',
      payload: {
        text: 'Create an architecture image',
        attachments: [],
        thinkingLevel: 'medium',
      },
      messages: [],
      nodeIdByMessageId: {},
      branchIdByMessageId: {},
    })
    expect(taskRuntimeMocks.broadcast).toHaveBeenCalledWith('sessions:resources-invalidated', {
      sessionId: SessionId('reused-session'),
    })
  })
})
