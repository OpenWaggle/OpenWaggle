import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  compactAgentSession: vi.fn(),
  emitTransportEvent: vi.fn(),
  executeAgentRun: vi.fn(),
  getAgentContextUsage: vi.fn(),
  typedHandle: vi.fn(),
}))

vi.mock('../typed-ipc', () => ({ typedHandle: mocks.typedHandle }))
vi.mock('../../agent/session-cleanup', () => ({ cleanupSessionRun: vi.fn() }))
vi.mock('../../application/agent-run-service', () => ({ executeAgentRun: mocks.executeAgentRun }))
vi.mock('../../application/agent-session-service', () => ({
  compactAgentSession: mocks.compactAgentSession,
  getAgentContextUsage: mocks.getAgentContextUsage,
}))
vi.mock('../../utils/broadcast', () => ({ broadcastToWindows: vi.fn() }))
vi.mock('../../utils/stream-bridge', () => ({
  clearAgentPhase: vi.fn(),
  clearStreamBuffer: vi.fn(),
  emitRunCompleted: vi.fn(),
  emitTransportEvent: mocks.emitTransportEvent,
  getStreamBuffer: vi.fn(),
  listStreamBuffers: vi.fn(() => []),
  startStreamBuffer: vi.fn(),
}))

import { activeCompactions, cancelAllSessionRuns } from '../active-agent-runs'
import { registerAgentHandlers } from '../agent-handler'

const SESSION_ID = SessionId('manual-compaction-session')
const MODEL = SupportedModelId('openai/gpt-5.4')

function compactHandler() {
  registerAgentHandlers()
  const handler = mocks.typedHandle.mock.calls.find(
    (call) => call[0] === 'agent:compact-session',
  )?.[1]
  if (typeof handler !== 'function') throw new Error('Expected compact-session handler')
  return handler
}

describe('agent manual compaction IPC lifecycle', () => {
  beforeEach(() => {
    cancelAllSessionRuns()
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.getAgentContextUsage.mockReturnValue(Effect.succeed(null))
  })

  it('emits a terminal compaction event when persistence fails after kernel success', async () => {
    const successfulEnd: AgentTransportEvent = {
      type: 'compaction_end',
      reason: 'manual',
      result: { summary: 'Compacted context' },
      aborted: false,
      willRetry: false,
      timestamp: 2,
    }
    mocks.compactAgentSession.mockImplementation((input) =>
      Effect.gen(function* () {
        input.onEvent({ type: 'compaction_start', reason: 'manual', timestamp: 1 })
        input.onEvent(successfulEnd)
        return yield* Effect.fail(new Error('snapshot persistence failed'))
      }),
    )

    await expect(Effect.runPromise(compactHandler()({}, SESSION_ID, MODEL))).rejects.toThrow(
      'snapshot persistence failed',
    )

    expect(mocks.emitTransportEvent).toHaveBeenLastCalledWith(
      SESSION_ID,
      expect.objectContaining({
        type: 'compaction_end',
        reason: 'manual',
        aborted: true,
        willRetry: false,
        errorMessage: 'snapshot persistence failed',
      }),
    )
    expect(activeCompactions.has(SESSION_ID)).toBe(false)
  })
})
