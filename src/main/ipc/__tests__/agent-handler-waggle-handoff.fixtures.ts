import { BUILT_IN_WAGGLE_PRESETS } from '@openwaggle/waggle-core'
import type { AgentSteerDeliveryResult, Message } from '@shared/types/agent'
import { MessageId, ToolCallId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import type { vi } from 'vitest'
import { toJsonValue } from '../../adapters/pi/pi-message-mapper'

export function installPendingAgentRun(
  executeAgentRun: ReturnType<typeof vi.fn>,
  nativeSteer: () => Promise<AgentSteerDeliveryResult>,
) {
  executeAgentRun.mockImplementation((input) =>
    Effect.async((resume) => {
      input.onControlAvailable?.({ steer: nativeSteer })
      input.signal.addEventListener('abort', () => resume(Effect.succeed({ outcome: 'aborted' })), {
        once: true,
      })
    }),
  )
}

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
