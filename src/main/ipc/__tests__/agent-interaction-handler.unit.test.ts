import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  cleanupSessionRunMock,
  compactAgentSessionMock,
  executeAgentRunMock,
  getAgentContextUsageMock,
  typedHandleMock,
} = vi.hoisted(() => ({
  cleanupSessionRunMock: vi.fn(),
  compactAgentSessionMock: vi.fn(),
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

vi.mock('../../application/agent-session-service', () => ({
  compactAgentSession: compactAgentSessionMock,
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

describe('agent interaction IPC handler', () => {
  beforeEach(() => {
    clearAgentLoopInteractionBrokerForTests()
    cleanupSessionRunMock.mockReset()
    compactAgentSessionMock.mockReset()
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
})
