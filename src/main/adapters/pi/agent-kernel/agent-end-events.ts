import { Schema } from '@shared/schema'
import { Option } from 'effect'
import type { AgentTransportAgentEndEvent } from '@shared/types/stream'

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

// explicit undefined: Pi sets stopReason, usage or errorMessage to undefined on its messages
const agentEndAssistantMessageSchema = Schema.Struct({
  role: Schema.Literal('assistant'),
  stopReason: Schema.optional(Schema.Unknown),
  usage: Schema.optional(Schema.Unknown),
  errorMessage: Schema.optional(Schema.Unknown),
})

const isAgentEndAssistantMessage = Schema.is(agentEndAssistantMessageSchema)

/** The token counts of an assistant message's `usage`, all three or none. */
const decodeAgentEndUsage = Schema.decodeUnknownOption(
  Schema.Struct({ input: Schema.Number, output: Schema.Number, totalTokens: Schema.Number }),
)

function getAgentEndAssistantMessage(messages: readonly unknown[]) {
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

export function getAgentEndUsage(messages: readonly unknown[]) {
  const assistantMessage = getAgentEndAssistantMessage(messages)
  const usage = Option.getOrUndefined(decodeAgentEndUsage(assistantMessage?.usage))
  if (!usage) {
    return undefined
  }
  const { input, output, totalTokens } = usage

  const event: AgentTransportAgentEndEvent['usage'] | undefined = {
    promptTokens: input,
    completionTokens: output,
    totalTokens,
  }
  return event
}

export function getAgentEndError(messages: readonly unknown[]) {
  const assistantMessage = getAgentEndAssistantMessage(messages)
  if (typeof assistantMessage?.errorMessage !== 'string') {
    return undefined
  }
  return { message: assistantMessage.errorMessage }
}
