import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { PI_WAGGLE_TURN_CUSTOM_TYPE } from '@openwaggle/pi-waggle/protocol'
import { PI_VISUALIZATION_CONTEXT_CUSTOM_TYPE } from './pi-runtime-input'

const VISUALIZATION_CONTEXT_START = '[OpenWaggle inline visualization context]'
const VISUALIZATION_CONTEXT_END = '[/OpenWaggle inline visualization context]'

export type PiContextMessage = Parameters<
  NonNullable<AgentSession['agent']['transformContext']>
>[0][number]

function stripVisualizationContext(text: string) {
  const start = text.lastIndexOf(VISUALIZATION_CONTEXT_START)
  if (start === -1) return text
  const end = text.indexOf(VISUALIZATION_CONTEXT_END, start)
  if (end === -1) return text
  return `${text.slice(0, start)}${text.slice(end + VISUALIZATION_CONTEXT_END.length)}`.trim()
}

function stripWaggleVisualizationContext(message: PiContextMessage): PiContextMessage {
  if (message.role !== 'custom' || message.customType !== PI_WAGGLE_TURN_CUSTOM_TYPE) {
    return message
  }
  if (typeof message.content === 'string') {
    return { ...message, content: stripVisualizationContext(message.content) }
  }
  return {
    ...message,
    content: message.content.map((part) =>
      part.type === 'text' ? { ...part, text: stripVisualizationContext(part.text) } : part,
    ),
  }
}

/**
 * Keeps visualization state visible to the provider only for the turn that supplied it.
 * Pi persists input messages for replay, so consumed asides and older Waggle snapshots must be
 * removed from later provider contexts without mutating the durable transcript.
 */
export async function filterConsumedVisualizationContext(
  messages: PiContextMessage[],
): Promise<PiContextMessage[]> {
  let latestPromptIndex = -1
  let latestVisualizationAsideIndex = -1
  for (const [index, message] of messages.entries()) {
    if (
      message.role === 'user' ||
      (message.role === 'custom' && message.customType === PI_WAGGLE_TURN_CUSTOM_TYPE)
    ) {
      latestPromptIndex = index
    }
    if (message.role === 'custom' && message.customType === PI_VISUALIZATION_CONTEXT_CUSTOM_TYPE) {
      latestVisualizationAsideIndex = index
    }
  }

  return messages.flatMap((message, index) => {
    if (message.role === 'custom' && message.customType === PI_VISUALIZATION_CONTEXT_CUSTOM_TYPE) {
      return index === latestVisualizationAsideIndex && index > latestPromptIndex ? [message] : []
    }
    return [index < latestPromptIndex ? stripWaggleVisualizationContext(message) : message]
  })
}

export function bindVisualizationContextFilter(session: AgentSession) {
  const previousTransform = session.agent.transformContext?.bind(session.agent)
  session.agent.transformContext = async (messages, signal) => {
    const transformed = previousTransform ? await previousTransform(messages, signal) : messages
    return filterConsumedVisualizationContext(transformed)
  }
}

export { PI_VISUALIZATION_CONTEXT_CUSTOM_TYPE }
