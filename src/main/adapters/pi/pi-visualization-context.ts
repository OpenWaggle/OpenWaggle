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

type PiCompactionContextTransform = (
  messages: PiContextMessage[],
  referenceMessages: PiContextMessage[],
  options: { willRetry: boolean },
  signal?: AbortSignal,
) => Promise<PiContextMessage[]>

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

function completesPromptTurn(message: PiContextMessage) {
  return (
    message.role === 'assistant' &&
    message.stopReason !== 'pending' &&
    message.stopReason !== 'toolUse' &&
    message.stopReason !== 'deferred'
  )
}

function promptFingerprint(message: PiContextMessage | undefined) {
  if (message?.role === 'user') {
    return JSON.stringify(['user', message.timestamp, message.content])
  }
  return message?.role === 'custom' && message.customType === PI_WAGGLE_TURN_CUSTOM_TYPE
    ? JSON.stringify(['waggle', message.timestamp, message.content, message.details])
    : null
}

/**
 * Keeps visualization state visible to the provider only for the turn that supplied it.
 * Pi persists input messages for replay, so consumed asides and older Waggle snapshots must be
 * removed from later provider contexts without mutating the durable transcript.
 */
export async function filterConsumedVisualizationContext(
  messages: PiContextMessage[],
  referenceMessages: PiContextMessage[] = messages,
  options: { willRetry?: boolean } = {},
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
  const referenceLatestPromptIndex = referenceMessages.findLastIndex(
    (message) => promptFingerprint(message) !== null,
  )
  const referenceLatestPromptCompleted =
    !options.willRetry &&
    referenceMessages.slice(referenceLatestPromptIndex + 1).some(completesPromptTurn)
  const latestPromptConsumed =
    latestPromptIndex < 0 ||
    promptFingerprint(messages[latestPromptIndex]) !==
      promptFingerprint(referenceMessages[referenceLatestPromptIndex]) ||
    referenceLatestPromptCompleted

  return messages.flatMap((message, index) => {
    if (message.role === 'custom' && message.customType === PI_VISUALIZATION_CONTEXT_CUSTOM_TYPE) {
      return !latestPromptConsumed &&
        index === latestVisualizationAsideIndex &&
        index > latestPromptIndex
        ? [message]
        : []
    }
    const cleanMessage = stripWaggleVisualizationContext(
      index < latestPromptIndex || (latestPromptConsumed && index === latestPromptIndex)
        ? stripConsumedAtomicVisualizationContext(message)
        : message,
    )
    const activeWaggleAside =
      !latestPromptConsumed && index === latestPromptIndex
        ? transientWaggleVisualizationAside(message)
        : null
    return activeWaggleAside ? [cleanMessage, activeWaggleAside] : [cleanMessage]
  })
}

export function bindVisualizationContextFilter(session: AgentSession) {
  const previousTransform = session.agent.transformContext?.bind(session.agent)
  const transformBaseContext = async (messages: PiContextMessage[], signal?: AbortSignal) =>
    previousTransform ? await previousTransform(messages, signal) : messages
  session.agent.transformContext = async (messages, signal) => {
    const transformed = await transformBaseContext(messages, signal)
    return filterConsumedVisualizationContext(transformed)
  }
  const transformCompactionContext: PiCompactionContextTransform = async (
    messages,
    referenceMessages,
    options,
  ) => filterConsumedVisualizationContext(messages, referenceMessages, options)
  Reflect.set(session.agent, 'transformCompactionContext', transformCompactionContext)
}

export { PI_VISUALIZATION_CONTEXT_CUSTOM_TYPE }
