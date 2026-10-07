import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { typedHandleMock, emitRunCompletedMock, getStreamBufferMock, cancelAllSessionRunsMock } =
  vi.hoisted(() => ({
    typedHandleMock: vi.fn(),
    emitRunCompletedMock: vi.fn(),
    getStreamBufferMock: vi.fn(),
    cancelAllSessionRunsMock: vi.fn(),
  }))

vi.mock('../typed-ipc', () => ({ hostHandle: typedHandleMock, typedHandle: typedHandleMock }))
vi.mock('../../agent/session-cleanup', () => ({ cleanupSessionRun: vi.fn() }))
vi.mock('../../application/local-session-command-dispatcher', () => ({
  dispatchLocalSessionCommand: vi.fn(),
}))
vi.mock('../../application/agent-session-service', () => ({ getAgentContextUsage: vi.fn() }))
vi.mock('../../utils/broadcast', () => ({ broadcastToWindows: vi.fn() }))
vi.mock('../../utils/stream-bridge', () => ({
  clearAgentPhase: vi.fn(),
  clearStreamBuffer: vi.fn(),
  emitRunCompleted: emitRunCompletedMock,
  getStreamBuffer: getStreamBufferMock,
}))
vi.mock('../active-agent-runs', () => ({ cancelAllSessionRuns: cancelAllSessionRunsMock }))

import { registerAgentHandlers } from '../agent-handler'

const SESSION_ID = SessionId('session-cancel')

function cancelHandler() {
  registerAgentHandlers()
  const handler = typedHandleMock.mock.calls.find(
    (candidate: readonly unknown[]) => candidate[0] === 'agent:cancel',
  )?.[1]
  if (typeof handler !== 'function') throw new Error('Expected agent:cancel to be registered')
  return handler
}

/*
 * Cancelling every Run settles each Session in the renderer, naming the Run its stream buffer held
 * as the Host names its settlements: the classic Run behind a requested Waggle.
 */
describe('agent:cancel completions', () => {
  beforeEach(() => {
    typedHandleMock.mockReset()
    emitRunCompletedMock.mockReset()
    cancelAllSessionRunsMock.mockReset().mockReturnValue([SESSION_ID])
  })

  it('names the classic Run behind a requested Waggle', async () => {
    getStreamBufferMock.mockReturnValue({ runId: 'waggle-of-run-X' })
    await Effect.runPromise(cancelHandler()({}, undefined))
    expect(emitRunCompletedMock).toHaveBeenCalledWith(SESSION_ID, { runId: 'run-X' })
  })

  it('settles a Session whose buffer names no Run unnamed', async () => {
    getStreamBufferMock.mockReturnValue(null)
    await Effect.runPromise(cancelHandler()({}, undefined))
    expect(emitRunCompletedMock).toHaveBeenCalledWith(SESSION_ID, {})
  })
})
