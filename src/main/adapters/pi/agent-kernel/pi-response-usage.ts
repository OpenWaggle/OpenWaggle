import { type AgentSession, calculateContextTokens } from '@earendil-works/pi-coding-agent'
import { createModelRef } from '@shared/types/llm'
import type { AgentTransportEvent } from '@shared/types/stream'
import { isPiVirtualModel } from '../pi-virtual-models'
import type { MessageEndSessionEvent, SessionListenerInput } from './listener-types'

type AssistantMessage = Extract<MessageEndSessionEvent['message'], { role: 'assistant' }>

/**
 * Listener inputs that keep context usage on the model that produced it. A response names the
 * physical model that answered, which differs from the selection under a virtual model, so its
 * usage is measured against that model's own window and never another model's.
 */
export function piResponseUsageInput(
  session: AgentSession,
): Pick<SessionListenerInput, 'getContextWindow' | 'isVirtualSelection'> {
  return {
    getContextWindow: (provider, modelId) => {
      const window = session.modelRuntime.getPhysicalModel(provider, modelId)?.contextWindow
      return window && window > 0 ? window : undefined
    },
    isVirtualSelection: () => (session.model ? isPiVirtualModel(session.model) : false),
  }
}

/**
 * The authoritative context usage of one completed response, measured against the window of the
 * model that produced it. None for a failed or aborted response, or when either value is unknown.
 */
export function responseContextUsageEvent(
  input: SessionListenerInput,
  message: AssistantMessage,
): AgentTransportEvent | null {
  const tokens = calculateContextTokens(message.usage)
  const contextWindow = input.getContextWindow?.(message.provider, message.model)
  if (message.stopReason === 'error' || message.stopReason === 'aborted') return null
  if (tokens <= 0 || !contextWindow || contextWindow <= 0) return null
  return {
    type: 'context_usage',
    tokens,
    contextWindow,
    timestamp: Date.now(),
    model: createModelRef(message.provider, message.model),
    ...(input.isVirtualSelection?.() ? { routedFrom: input.model } : {}),
  }
}
