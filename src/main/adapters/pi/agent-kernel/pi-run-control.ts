import type { AgentSession } from '@earendil-works/pi-coding-agent'
import type { AgentKernelRunControl } from '../../../ports/agent-kernel-service'
import type { PiModel } from '../pi-provider-catalog'
import { buildPiPromptInput, PI_VISUALIZATION_CONTEXT_CUSTOM_TYPE } from '../pi-runtime-input'

type PiSteeringSession = Pick<AgentSession, 'sendCustomMessage' | 'sendUserMessage'>

export function createPiRunControl(
  session: PiSteeringSession,
  model: Pick<PiModel, 'input'>,
): AgentKernelRunControl {
  return {
    steer: async (payload) => {
      const promptInput = buildPiPromptInput(model, payload)
      if (promptInput.visualizationContext) {
        await session.sendCustomMessage(
          {
            customType: PI_VISUALIZATION_CONTEXT_CUSTOM_TYPE,
            content: promptInput.visualizationContext,
            display: false,
            details: { source: 'openwaggle', kind: 'inline-visualization-context' },
          },
          { deliverAs: 'nextTurn', triggerTurn: false },
        )
      }
      const content =
        promptInput.images.length > 0
          ? [
              ...(promptInput.text ? [{ type: 'text' as const, text: promptInput.text }] : []),
              ...promptInput.images,
            ]
          : promptInput.text
      await session.sendUserMessage(content, { deliverAs: 'steer' })
    },
  }
}
