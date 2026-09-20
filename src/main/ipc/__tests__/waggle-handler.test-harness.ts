import { SessionId, SupportedModelId } from '@shared/types/brand'
import { WAGGLE_INHERIT_MODEL, type WaggleConfig } from '@shared/types/waggle'
import * as Effect from 'effect/Effect'
import { type Mock, vi } from 'vitest'

const {
  broadcastToWindowsMock,
  captureSuccessfulRunResourcesMock,
  clearAgentPhaseMock,
  clearStreamBufferMock,
  emitErrorAndFinishMock,
  emitRunCompletedMock,
  emitTransportEventMock,
  emitWaggleTransportEventMock,
  emitWaggleTurnEventMock,
  emitWorktreeLaunchFailureMock,
  emitWorktreeLaunchProgressMock,
  executeWaggleRunMock,
  startStreamBufferMock,
  typedHandleMock,
  typedOnMock,
}: Record<
  | 'broadcastToWindowsMock'
  | 'captureSuccessfulRunResourcesMock'
  | 'clearAgentPhaseMock'
  | 'clearStreamBufferMock'
  | 'emitErrorAndFinishMock'
  | 'emitRunCompletedMock'
  | 'emitTransportEventMock'
  | 'emitWaggleTransportEventMock'
  | 'emitWaggleTurnEventMock'
  | 'emitWorktreeLaunchFailureMock'
  | 'emitWorktreeLaunchProgressMock'
  | 'executeWaggleRunMock'
  | 'startStreamBufferMock'
  | 'typedHandleMock'
  | 'typedOnMock',
  Mock
> = vi.hoisted(() => ({
  broadcastToWindowsMock: vi.fn(),
  captureSuccessfulRunResourcesMock: vi.fn(),
  clearAgentPhaseMock: vi.fn(),
  clearStreamBufferMock: vi.fn(),
  emitErrorAndFinishMock: vi.fn(),
  emitRunCompletedMock: vi.fn(),
  emitTransportEventMock: vi.fn(),
  emitWaggleTransportEventMock: vi.fn(),
  emitWaggleTurnEventMock: vi.fn(),
  emitWorktreeLaunchFailureMock: vi.fn(),
  emitWorktreeLaunchProgressMock: vi.fn(),
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

vi.mock('../../application/session-resource-capture', () => ({
  captureSuccessfulRunResources: captureSuccessfulRunResourcesMock,
}))

vi.mock('../../utils/broadcast', () => ({
  broadcastToWindows: broadcastToWindowsMock,
}))

vi.mock('../../utils/stream-bridge', () => ({
  clearAgentPhase: clearAgentPhaseMock,
  clearStreamBuffer: clearStreamBufferMock,
  emitErrorAndFinish: emitErrorAndFinishMock,
  emitRunCompleted: emitRunCompletedMock,
  emitTransportEvent: emitTransportEventMock,
  emitWaggleTransportEvent: emitWaggleTransportEventMock,
  emitWaggleTurnEvent: emitWaggleTurnEventMock,
  emitWorktreeLaunchFailure: emitWorktreeLaunchFailureMock,
  emitWorktreeLaunchProgress: emitWorktreeLaunchProgressMock,
  startStreamBuffer: startStreamBufferMock,
}))

import { cancelAllSessionRuns } from '../active-agent-runs'
import { registerWaggleHandlers as registerHandlers } from '../waggle-handler'

function registerWaggleHandlers() {
  registerHandlers()
}

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

export function resetWaggleHandlerMocks() {
  cancelAllSessionRuns()
  broadcastToWindowsMock.mockReset()
  captureSuccessfulRunResourcesMock.mockReset()
  captureSuccessfulRunResourcesMock.mockReturnValue(Effect.void)
  clearAgentPhaseMock.mockReset()
  clearStreamBufferMock.mockReset()
  emitErrorAndFinishMock.mockReset()
  emitRunCompletedMock.mockReset()
  emitTransportEventMock.mockReset()
  emitWaggleTransportEventMock.mockReset()
  emitWaggleTurnEventMock.mockReset()
  emitWorktreeLaunchFailureMock.mockReset()
  emitWorktreeLaunchProgressMock.mockReset()
  executeWaggleRunMock.mockReset()
  startStreamBufferMock.mockReset()
  typedHandleMock.mockReset()
  typedOnMock.mockReset()
}

export {
  broadcastToWindowsMock,
  captureSuccessfulRunResourcesMock,
  clearAgentPhaseMock,
  clearStreamBufferMock,
  emitErrorAndFinishMock,
  emitRunCompletedMock,
  emitTransportEventMock,
  emitWaggleTransportEventMock,
  emitWaggleTurnEventMock,
  emitWorktreeLaunchFailureMock,
  emitWorktreeLaunchProgressMock,
  executeWaggleRunMock,
  getSendHandler,
  inheritedFirstAgentConfig,
  registerWaggleHandlers,
  SELECTED_MODEL,
  SESSION_ID,
  startStreamBufferMock,
  typedHandleMock,
  typedOnMock,
}
