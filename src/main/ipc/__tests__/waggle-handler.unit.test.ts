import { SessionId, SupportedModelId } from '@shared/types/brand'
import { WAGGLE_INHERIT_MODEL, type WaggleConfig } from '@shared/types/waggle'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  broadcastToWindowsMock,
  clearAgentPhaseMock,
  clearStreamBufferMock,
  emitRunCompletedMock,
  emitTransportEventMock,
  emitWaggleTransportEventMock,
  emitWaggleTurnEventMock,
  executeWaggleRunMock,
  startStreamBufferMock,
  typedHandleMock,
  typedOnMock,
} = vi.hoisted(() => ({
  broadcastToWindowsMock: vi.fn(),
  clearAgentPhaseMock: vi.fn(),
  clearStreamBufferMock: vi.fn(),
  emitRunCompletedMock: vi.fn(),
  emitTransportEventMock: vi.fn(),
  emitWaggleTransportEventMock: vi.fn(),
  emitWaggleTurnEventMock: vi.fn(),
  executeWaggleRunMock: vi.fn(),
  startStreamBufferMock: vi.fn(),
  typedHandleMock: vi.fn(),
  typedOnMock: vi.fn(),
}))

vi.mock('../typed-ipc', () => ({
  typedHandle: typedHandleMock,
  typedOn: typedOnMock,
}))

vi.mock('../../application/waggle-run-service', () => ({
  executeWaggleRun: executeWaggleRunMock,
}))

vi.mock('../../utils/broadcast', () => ({
  broadcastToWindows: broadcastToWindowsMock,
}))

vi.mock('../../utils/stream-bridge', () => ({
  clearAgentPhase: clearAgentPhaseMock,
  clearStreamBuffer: clearStreamBufferMock,
  emitRunCompleted: emitRunCompletedMock,
  emitTransportEvent: emitTransportEventMock,
  emitWaggleTransportEvent: emitWaggleTransportEventMock,
  emitWaggleTurnEvent: emitWaggleTurnEventMock,
  startStreamBuffer: startStreamBufferMock,
}))

import { cancelAllSessionRuns } from '../active-agent-runs'
import { registerWaggleHandlers } from '../waggle-handler'

const SESSION_ID = SessionId('session-1')
const SELECTED_MODEL = SupportedModelId('openai/gpt-5.4')

function inheritedFirstAgentConfig(): WaggleConfig {
  return {
    mode: 'sequential',
    agents: [
      {
        label: 'Architect',
        model: WAGGLE_INHERIT_MODEL,
        roleDescription: 'Plans the implementation',
        color: 'blue',
      },
      {
        label: 'Reviewer',
        model: SupportedModelId('anthropic/claude-sonnet-4-5'),
        roleDescription: 'Reviews the implementation',
        color: 'amber',
      },
    ],
    stop: { primary: 'consensus', maxTurnsSafety: 4 },
  }
}

function getSendHandler() {
  const call = typedHandleMock.mock.calls.find(
    (args: readonly unknown[]) => args[0] === 'agent:send-waggle-message',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') {
    throw new Error('Expected agent:send-waggle-message handler to be registered')
  }
  return handler
}

describe('registerWaggleHandlers', () => {
  beforeEach(() => {
    cancelAllSessionRuns()
    broadcastToWindowsMock.mockReset()
    clearAgentPhaseMock.mockReset()
    clearStreamBufferMock.mockReset()
    emitRunCompletedMock.mockReset()
    emitTransportEventMock.mockReset()
    emitWaggleTransportEventMock.mockReset()
    emitWaggleTurnEventMock.mockReset()
    executeWaggleRunMock.mockReset()
    startStreamBufferMock.mockReset()
    typedHandleMock.mockReset()
    typedOnMock.mockReset()
  })

  it('starts the Waggle stream buffer with the resolved runtime model for inherited first-agent runs', async () => {
    executeWaggleRunMock.mockImplementation((input) =>
      Effect.sync(() => {
        input.onRunPrepared?.(SELECTED_MODEL)
        return { outcome: 'success', newMessages: [] }
      }),
    )

    registerWaggleHandlers()
    const send = getSendHandler()

    await Effect.runPromise(
      send(
        {},
        SESSION_ID,
        { text: 'Review this patch', thinkingLevel: 'medium', attachments: [] },
        SELECTED_MODEL,
        inheritedFirstAgentConfig(),
      ),
    )

    expect(executeWaggleRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: SELECTED_MODEL }),
    )
    expect(startStreamBufferMock).toHaveBeenCalledWith(SESSION_ID, SELECTED_MODEL, 'waggle')
    expect(emitTransportEventMock).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({ type: 'agent_start', runId: `waggle-${SESSION_ID}` }),
    )
  })
})
