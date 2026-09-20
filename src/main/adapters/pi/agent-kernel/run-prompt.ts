import type { AgentSession } from '@earendil-works/pi-coding-agent'
import type { HydratedAgentSendPayload } from '@shared/types/agent'
import type { PiModel } from '../pi-provider-catalog'
import { buildPiPromptInput, PI_VISUALIZATION_CONTEXT_CUSTOM_TYPE } from '../pi-runtime-input'

export async function promptPiSession(
  session: AgentSession,
  model: PiModel,
  payload: HydratedAgentSendPayload,
) {
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
  await session.prompt(
    promptInput.text,
    promptInput.images.length > 0 ? { images: [...promptInput.images] } : undefined,
  )
}
