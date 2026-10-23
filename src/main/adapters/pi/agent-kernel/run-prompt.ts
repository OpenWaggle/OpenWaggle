import type { AgentSession } from '@earendil-works/pi-coding-agent'
import type { HydratedAgentSendPayload, MessageScheduledTaskOrigin } from '@shared/types/agent'
import type { PiModel } from '../pi-provider-catalog'
import { buildPiPromptInput, PI_VISUALIZATION_CONTEXT_CUSTOM_TYPE } from '../pi-runtime-input'
import { enqueueUserInputProjection } from './user-input-projection'

export async function promptPiSession(
  session: AgentSession,
  model: PiModel,
  payload: HydratedAgentSendPayload,
  /** The Scheduled task whose run sent this prompt, recorded with its display projection. */
  scheduledTask?: MessageScheduledTaskOrigin,
) {
  const promptInput = buildPiPromptInput(model, payload)
  const cancelProjection = enqueueUserInputProjection(session, payload, undefined, scheduledTask)
  try {
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
  } finally {
    cancelProjection()
  }
}
