import { SessionId, SupportedModelId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { dispatchLocalSessionCommandMock, typedHandleMock } = vi.hoisted(() => ({
  dispatchLocalSessionCommandMock: vi.fn(),
  typedHandleMock: vi.fn(),
}))

vi.mock('../typed-ipc', () => ({
  hostHandle: typedHandleMock,
  typedHandle: typedHandleMock,
}))

vi.mock('../../agent/session-cleanup', () => ({
  cleanupSessionRun: vi.fn(),
}))

vi.mock('../../application/local-session-command-dispatcher', () => ({
  dispatchLocalSessionCommand: dispatchLocalSessionCommandMock,
}))

vi.mock('../../application/agent-session-service', () => ({
  getAgentContextUsage: vi.fn(),
}))

vi.mock('../../utils/broadcast', () => ({
  broadcastToWindows: vi.fn(),
}))

vi.mock('../../utils/stream-bridge', () => ({
  clearAgentPhase: vi.fn(),
  clearStreamBuffer: vi.fn(),
  emitRunCompleted: vi.fn(),
  getStreamBuffer: vi.fn(),
}))

import { registerAgentHandlers } from '../agent-handler'

const SESSION_ID = SessionId('session-send')
const MODEL = SupportedModelId('openrouter/some-model')
const PAYLOAD = { text: 'try again', thinkingLevel: 'medium', attachments: [] } as const

function getSendHandler() {
  registerAgentHandlers()
  const call = typedHandleMock.mock.calls.find(
    (candidate: readonly unknown[]) => candidate[0] === 'agent:send-message',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') {
    throw new Error('Expected agent:send-message handler to be registered')
  }
  return handler
}

function hostReplies(outcome: unknown) {
  dispatchLocalSessionCommandMock.mockReturnValue(
    Effect.succeed({
      contract: 'session-control-v2',
      response: {
        contractVersion: 2,
        requestId: 'request',
        idempotencyKey: 'idempotency',
        replayed: false,
        outcome,
      },
    }),
  )
}

describe('agent:send-message report', () => {
  beforeEach(() => {
    dispatchLocalSessionCommandMock.mockReset()
    typedHandleMock.mockReset()
  })

  // The report names the Run, so the renderer credits only that Run's completion to this send.
  it('reports a started Run as delivered, naming the Run', async () => {
    hostReplies({
      operation: 'message',
      effect: 'started-run',
      sessionId: SESSION_ID,
      runId: 'run-1',
      stateRevision: 2,
    })

    const report = await Effect.runPromise(getSendHandler()({}, SESSION_ID, PAYLOAD, MODEL))

    expect(report).toEqual({ outcome: 'delivered', runId: 'run-1' })
  })

  /*
   * The Host appends a message to the Follow-up queue instead of starting a Run while the Session
   * still has a Run, including one Pi has ended that the Host has not settled yet. Reporting that
   * as "delivered" told the renderer a Run was on its way; none was, so it waited for a completion
   * that never came and showed Stop and "Thinking" over an idle Session.
   */
  it('reports a message the Host queued as queued, not delivered', async () => {
    hostReplies({
      operation: 'message',
      effect: 'queued-follow-up',
      sessionId: SESSION_ID,
      followUpId: 'follow-up-1',
      queueRevision: 4,
      stateRevision: 3,
    })

    const report = await Effect.runPromise(getSendHandler()({}, SESSION_ID, PAYLOAD, MODEL))

    expect(report).toEqual({ outcome: 'queued' })
  })

  it('reports a Host rejection as refused', async () => {
    hostReplies({
      operation: 'message',
      effect: 'rejected',
      sessionId: SESSION_ID,
      code: 'queue_capacity_reached',
    })

    const report = await Effect.runPromise(getSendHandler()({}, SESSION_ID, PAYLOAD, MODEL))

    expect(report).toEqual({
      outcome: 'refused',
      message: 'queue_capacity_reached',
      code: 'queue_capacity_reached',
    })
  })
})
