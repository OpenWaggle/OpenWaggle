import type { AgentTransportAgentEndEvent } from '@shared/types/stream'
import { isRecord } from '@shared/utils/validation'

function isAgentEndReason(
  value: unknown,
): value is 'stop' | 'length' | 'toolUse' | 'error' | 'aborted' {
  return (
    value === 'stop' ||
    value === 'length' ||
    value === 'toolUse' ||
    value === 'error' ||
    value === 'aborted'
  )
}

interface AgentEndAssistantMessage {
  readonly role: 'assistant'
  readonly stopReason?: unknown
  readonly usage?: unknown
  readonly errorMessage?: unknown
}

function isAgentEndAssistantMessage(message: unknown): message is AgentEndAssistantMessage {
  return isRecord(message) && message.role === 'assistant'
}

function getAgentEndAssistantMessage(
  messages: readonly unknown[],
): AgentEndAssistantMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (isAgentEndAssistantMessage(message)) {
      return message
    }
  }
  return null
}

export function getAgentEndReason(messages: readonly unknown[]) {
  const assistantMessage = getAgentEndAssistantMessage(messages)
  if (!assistantMessage) {
    return null
  }
  return isAgentEndReason(assistantMessage.stopReason) ? assistantMessage.stopReason : null
}

export function getAgentEndUsage(
  messages: readonly unknown[],
): AgentTransportAgentEndEvent['usage'] | undefined {
  const assistantMessage = getAgentEndAssistantMessage(messages)
  const usage = assistantMessage?.usage
  if (!isRecord(usage)) {
    return undefined
  }

  const input = typeof usage.input === 'number' ? usage.input : null
  const output = typeof usage.output === 'number' ? usage.output : null
  const totalTokens = typeof usage.totalTokens === 'number' ? usage.totalTokens : null
  if (input === null || output === null || totalTokens === null) {
    return undefined
  }

  return {
    promptTokens: input,
    completionTokens: output,
    totalTokens,
  }
}

export function getAgentEndError(messages: readonly unknown[]) {
  const assistantMessage = getAgentEndAssistantMessage(messages)
  if (typeof assistantMessage?.errorMessage !== 'string') {
    return undefined
  }
  return { message: assistantMessage.errorMessage }
}
