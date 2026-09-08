import { BUILT_IN_WAGGLE_PRESETS } from '@openwaggle/waggle-core'
import type { AgentSteerDeliveryResult, Message } from '@shared/types/agent'
import { MessageId, SessionId, SupportedModelId, ToolCallId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { type Mock, vi } from 'vitest'
import { toJsonValue } from '../../adapters/pi/pi-message-mapper'

const mocks: Record<
  | 'clearAgentPhase'
  | 'clearStreamBuffer'
  | 'compactAgentSession'
  | 'captureSuccessfulRunResources'
  | 'emitErrorAndFinish'
  | 'emitRunCompleted'
  | 'emitTransportEvent'
  | 'emitWorktreeLaunchFailure'
  | 'emitWaggleTransportEvent'
  | 'emitWaggleTurnEvent'
  | 'executeAgentRun'
  | 'executeWaggleRun'
  | 'getAgentContextUsage'
  | 'hydrateAgentRunPayload'
  | 'startStreamBuffer'
  | 'typedHandle',
  Mock
> = vi.hoisted(() => ({
  clearAgentPhase: vi.fn(),
  clearStreamBuffer: vi.fn(),
  compactAgentSession: vi.fn(),
  captureSuccessfulRunResources: vi.fn(),
  emitErrorAndFinish: vi.fn(),
  emitRunCompleted: vi.fn(),
  emitTransportEvent: vi.fn(),
  emitWorktreeLaunchFailure: vi.fn(),
  emitWaggleTransportEvent: vi.fn(),
  emitWaggleTurnEvent: vi.fn(),
  executeAgentRun: vi.fn(),
  executeWaggleRun: vi.fn(),
  getAgentContextUsage: vi.fn(),
  hydrateAgentRunPayload: vi.fn(),
  startStreamBuffer: vi.fn(),
  typedHandle: vi.fn(),
}))

export { mocks }

vi.mock('../typed-ipc', () => ({ typedHandle: mocks.typedHandle }))
vi.mock('../../agent/session-cleanup', () => ({ cleanupSessionRun: vi.fn() }))
vi.mock('../../application/agent-run-service', () => ({ executeAgentRun: mocks.executeAgentRun }))
vi.mock('../../application/agent-run/kernel', () => ({
  hydrateAgentRunPayload: mocks.hydrateAgentRunPayload,
}))
vi.mock('../../application/agent-session-service', () => ({
  compactAgentSession: mocks.compactAgentSession,
  getAgentContextUsage: mocks.getAgentContextUsage,
}))
vi.mock('../../application/session-resource-capture', () => ({
  captureSuccessfulRunResources: mocks.captureSuccessfulRunResources,
}))
vi.mock('../../application/waggle-run-service', () => ({
  executeWaggleRun: mocks.executeWaggleRun,
}))
vi.mock('../../utils/broadcast', () => ({ broadcastToWindows: vi.fn() }))
vi.mock('../../utils/stream-bridge', () => ({
  clearAgentPhase: mocks.clearAgentPhase,
  clearStreamBuffer: mocks.clearStreamBuffer,
  emitRunCompleted: mocks.emitRunCompleted,
  emitTransportEvent: mocks.emitTransportEvent,
  emitWorktreeLaunchFailure: mocks.emitWorktreeLaunchFailure,
  emitWaggleTransportEvent: mocks.emitWaggleTransportEvent,
  emitWaggleTurnEvent: mocks.emitWaggleTurnEvent,
  getStreamBuffer: vi.fn(),
  listStreamBuffers: vi.fn(() => []),
  startStreamBuffer: mocks.startStreamBuffer,
}))
vi.mock('../run-handler-utils', () => ({ emitErrorAndFinish: mocks.emitErrorAndFinish }))

import { cancelAllSessionRuns } from '../active-agent-runs'
import { registerAgentHandlers } from '../agent-handler'

export const SESSION_ID = SessionId('agent-handoff-session')
export const MODEL = SupportedModelId('openai/gpt-5.4')
export const PAYLOAD = { text: 'Review this', thinkingLevel: 'medium', attachments: [] } as const
export const STEER_DELIVERY = { delivery: 'queued', durableText: PAYLOAD.text } as const
export const STEER_RESULT = { preserved: true, delivery: STEER_DELIVERY } as const

export function handoffMessage(): Message {
  const preset = BUILT_IN_WAGGLE_PRESETS[0]
  if (!preset) throw new Error('Expected a built-in Waggle preset')
  return {
    id: MessageId('handoff-message'),
    role: 'assistant',
    createdAt: 1,
    parts: [
      {
        type: 'tool-result',
        toolResult: {
          id: ToolCallId('waggle-invoke-call'),
          name: 'waggle_invoke',
          args: {},
          result: null,
          isError: false,
          duration: 1,
          details: toJsonValue({
            kind: 'waggle-handoff',
            presetId: preset.id,
            presetName: preset.name,
            source: 'agent',
            config: preset.config,
            prompt: 'Review the durable result.',
          }),
        },
      },
    ],
  }
}

function registeredHandler(channel: string) {
  const handler = mocks.typedHandle.mock.calls.find((call) => call[0] === channel)?.[1]
  if (typeof handler !== 'function') throw new Error(`Expected ${channel} handler`)
  return handler
}

export function registerHandlers() {
  registerAgentHandlers()
  return {
    cancel: registeredHandler('agent:cancel'),
    send: registeredHandler('agent:send-message'),
    steer: registeredHandler('agent:steer'),
  }
}

export function installPendingAgentRun(nativeSteer: () => Promise<AgentSteerDeliveryResult>) {
  mocks.executeAgentRun.mockImplementation((input) =>
    Effect.async((resume) => {
      input.onControlAvailable?.({ steer: nativeSteer })
      input.signal.addEventListener('abort', () => resume(Effect.succeed({ outcome: 'aborted' })), {
        once: true,
      })
    }),
  )
}

export function resetAgentHandlerMocks() {
  cancelAllSessionRuns()
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.compactAgentSession.mockReturnValue(Effect.void)
  mocks.captureSuccessfulRunResources.mockReturnValue(Effect.void)
  mocks.getAgentContextUsage.mockReturnValue(Effect.succeed(null))
  mocks.hydrateAgentRunPayload.mockImplementation((payload) => Effect.succeed(payload))
}
