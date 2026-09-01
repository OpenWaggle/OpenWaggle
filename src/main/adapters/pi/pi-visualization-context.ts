import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { PI_WAGGLE_TURN_CUSTOM_TYPE } from '@openwaggle/pi-waggle/protocol'
import { isRecord } from '@shared/utils/validation'
import {
  PI_VISUALIZATION_CONTEXT_CUSTOM_TYPE,
  stripAtomicVisualizationContext,
} from './pi-runtime-input'

const WAGGLE_VISUALIZATION_CONTEXT_DETAIL = 'openWaggleVisualizationContext'

export type PiContextMessage = Parameters<
  NonNullable<AgentSession['agent']['transformContext']>
>[0][number]

function readWaggleVisualizationContext(message: PiContextMessage) {
  if (
    message.role !== 'custom' ||
    message.customType !== PI_WAGGLE_TURN_CUSTOM_TYPE ||
    !isRecord(message.details)
  ) {
    return null
  }
  const context = message.details[WAGGLE_VISUALIZATION_CONTEXT_DETAIL]
  return typeof context === 'string' && context.length > 0 ? context : null
}

function transientWaggleVisualizationAside(message: PiContextMessage): PiContextMessage | null {
  const context = readWaggleVisualizationContext(message)
  if (!context) return null
  return {
    role: 'custom',
    customType: PI_VISUALIZATION_CONTEXT_CUSTOM_TYPE,
    content: context,
    display: false,
    details: { source: 'openwaggle', kind: 'inline-visualization-context' },
    timestamp: message.timestamp,
  }
}

function stripWaggleVisualizationContext(message: PiContextMessage): PiContextMessage {
  if (message.role !== 'custom' || message.customType !== PI_WAGGLE_TURN_CUSTOM_TYPE) {
    return message
  }
  const details = isRecord(message.details)
    ? Object.fromEntries(
        Object.entries(message.details).filter(
          ([key]) => key !== WAGGLE_VISUALIZATION_CONTEXT_DETAIL,
        ),
      )
    : message.details
  return { ...message, details }
}

function stripConsumedAtomicVisualizationContext(message: PiContextMessage) {
  if (message.role !== 'user') return message
  if (typeof message.content === 'string') {
    return { ...message, content: stripAtomicVisualizationContext(message.content) }
  }
  return {
    ...message,
    content: message.content.map((part) =>
      part.type === 'text' ? { ...part, text: stripAtomicVisualizationContext(part.text) } : part,
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
    const cleanMessage = stripWaggleVisualizationContext(
      index < latestPromptIndex ? stripConsumedAtomicVisualizationContext(message) : message,
    )
    const activeWaggleAside =
      index === latestPromptIndex ? transientWaggleVisualizationAside(message) : null
    return activeWaggleAside ? [cleanMessage, activeWaggleAside] : [cleanMessage]
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
