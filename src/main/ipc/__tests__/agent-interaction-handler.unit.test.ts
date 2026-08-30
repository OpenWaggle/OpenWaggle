import { SessionId, SupportedModelId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  cleanupSessionRunMock,
  dispatchLocalSessionCommandMock,
  executeAgentRunMock,
  getAgentContextUsageMock,
  typedHandleMock,
} = vi.hoisted(() => ({
  cleanupSessionRunMock: vi.fn(),
  dispatchLocalSessionCommandMock: vi.fn(),
  executeAgentRunMock: vi.fn(),
  getAgentContextUsageMock: vi.fn(),
  typedHandleMock: vi.fn(),
}))

vi.mock('../typed-ipc', () => ({
  typedHandle: typedHandleMock,
}))

vi.mock('../../agent/session-cleanup', () => ({
  cleanupSessionRun: cleanupSessionRunMock,
}))

vi.mock('../../application/agent-run-service', () => ({
  executeAgentRun: executeAgentRunMock,
}))

vi.mock('../../application/local-session-command-dispatcher', () => ({
  dispatchLocalSessionCommand: dispatchLocalSessionCommandMock,
}))

vi.mock('../../application/agent-session-service', () => ({
  getAgentContextUsage: getAgentContextUsageMock,
}))

vi.mock('../../utils/broadcast', () => ({
  broadcastToWindows: vi.fn(),
}))

vi.mock('../../utils/stream-bridge', () => ({
  clearAgentPhase: vi.fn(),
  clearStreamBuffer: vi.fn(),
  emitRunCompleted: vi.fn(),
  emitTransportEvent: vi.fn(),
  getStreamBuffer: vi.fn(),
  listStreamBuffers: vi.fn(() => []),
  startStreamBuffer: vi.fn(),
}))

import { clearAgentLoopInteractionBrokerForTests } from '../../application/agent-loop-interaction-broker'
import { registerAgentHandlers } from '../agent-handler'

function getResponseHandler() {
  registerAgentHandlers()
  const call = typedHandleMock.mock.calls.find(
    (candidate: readonly unknown[]) => candidate[0] === 'agent:respond-interaction',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') {
    throw new Error('Expected agent:respond-interaction handler to be registered')
  }
  return handler
}

function getCompactionHandler() {
  registerAgentHandlers()
  const call = typedHandleMock.mock.calls.find(
    (candidate: readonly unknown[]) => candidate[0] === 'agent:compact-session',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') {
    throw new Error('Expected agent:compact-session handler to be registered')
  }
  return handler
}

function getCancelHandler() {
  registerAgentHandlers()
  const call = typedHandleMock.mock.calls.find(
    (candidate: readonly unknown[]) => candidate[0] === 'agent:cancel',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') {
    throw new Error('Expected agent:cancel handler to be registered')
  }
  return handler
}

describe('agent interaction IPC handler', () => {
  beforeEach(() => {
    clearAgentLoopInteractionBrokerForTests()
    cleanupSessionRunMock.mockReset()
    dispatchLocalSessionCommandMock.mockReset().mockReturnValue(
      Effect.succeed({
        contract: 'session-query-v2',
        response: {
          contractVersion: 2,
          requestId: 'requests-list',
          outcome: { operation: 'requests-list', sessionId: 'missing-session', requests: [] },
        },
      }),
    )
    executeAgentRunMock.mockReset()
    getAgentContextUsageMock.mockReset()
    typedHandleMock.mockReset()
  })

  it('registers the response channel and returns broker errors for missing interactions', async () => {
    const handler = getResponseHandler()

    const result = await Effect.runPromise(
      handler(
        {},
        {
          sessionId: SessionId('missing-session'),
          runId: 'run-missing',
          interactionId: 'missing-interaction',
          kind: 'confirm',
          response: { kind: 'confirm', accepted: true },
        },
      ),
    )

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'interaction-not-found' },
    })
  })

  it('rejects malformed response payloads at the IPC boundary', async () => {
    const handler = getResponseHandler()

    await expect(
      Effect.runPromise(
        handler(
          {},
          {
            sessionId: 'session-1',
            runId: 'run-1',
            interactionId: 'interaction-1',
            kind: 'confirm',
            response: { kind: 'confirm' },
          },
        ),
      ),
    ).rejects.toThrow()
  })

  it('routes manual compaction through the owning Session Host', async () => {
    dispatchLocalSessionCommandMock.mockImplementationOnce((input) =>
      Effect.succeed({
        contract: 'local-compaction-v1',
        response: {
          requestId: input.payload.request.requestId,
          sessionId: 'remote-session',
          result: { summary: 'summary', firstKeptEntryId: 'kept-entry', tokensBefore: 42 },
        },
      }),
    )
    const handler = getCompactionHandler()

    await expect(
      Effect.runPromise(
        handler(
          {},
          SessionId('remote-session'),
          SupportedModelId('openai/gpt-5.5'),
          'Compact remotely.',
        ),
      ),
    ).resolves.toEqual({ summary: 'summary', firstKeptEntryId: 'kept-entry', tokensBefore: 42 })
    expect(dispatchLocalSessionCommandMock).toHaveBeenCalledWith({
      caller: { callerId: 'gui:local-user' },
      payload: {
        contract: 'local-compaction-v1',
        request: expect.objectContaining({
          sessionId: 'remote-session',
          model: 'openai/gpt-5.5',
          customInstructions: 'Compact remotely.',
        }),
      },
    })
  })

  it('routes cancellation to the owning compaction when no ordinary run is active', async () => {
    dispatchLocalSessionCommandMock
      .mockReturnValueOnce(
        Effect.succeed({
          contract: 'session-query-v2',
          response: {
            contractVersion: 2,
            requestId: 'status-request',
            outcome: {
              operation: 'status',
              sessionId: 'remote-session',
              stateRevision: 1,
              queueState: 'idle',
              queueRevision: 0,
              activeRunId: null,
              pendingFollowUpCount: 0,
            },
          },
        }),
      )
      .mockImplementationOnce((input) =>
        Effect.succeed({
          contract: 'local-compaction-cancel-v1',
          response: {
            requestId: input.payload.request.requestId,
            sessionId: 'remote-session',
            cancelled: true,
          },
        }),
      )

    await expect(
      Effect.runPromise(getCancelHandler()({}, SessionId('remote-session'))),
    ).resolves.toBeUndefined()
    expect(dispatchLocalSessionCommandMock).toHaveBeenLastCalledWith({
      caller: { callerId: 'gui:local-user' },
      payload: {
        contract: 'local-compaction-cancel-v1',
        request: expect.objectContaining({ sessionId: 'remote-session' }),
      },
    })
  })
})
