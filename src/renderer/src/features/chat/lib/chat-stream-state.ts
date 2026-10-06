import { matchBy } from '@diegogbrisa/ts-match'
import type { UIMessage } from '@shared/types/chat-ui'
import type { AgentTransportEvent } from '@shared/types/stream'
import { applyAssistantMessageEvent } from './chat-stream-message-events'
import { ensureAssistantMessage } from './chat-stream-state-helpers'
import {
  finishToolExecution,
  startToolExecution,
  updateToolExecution,
} from './chat-stream-tool-events'
import { applyIncorporatedUserMessage } from './chat-stream-user-messages'

/**
 * An update (a text delta, a tool's start) starts its message when the message's start was lost:
 * the message then takes the update's Host time, as `ensureAssistantMessage` gives a started one,
 * not this renderer's clock.
 */
function stampStartedMessage(
  before: readonly UIMessage[],
  after: UIMessage[],
  event: { readonly timestamp: number },
) {
  // Most updates change a shown message: only a longer list can hold a started one.
  if (after.length <= before.length) return after
  const shownIds = new Set(before.map((message) => message.id))
  return after.map((message) =>
    shownIds.has(message.id) ? message : { ...message, createdAt: new Date(event.timestamp) },
  )
}

/**
 * The messages after a transport event. An event that changes no message (lifecycle, queue,
 * compaction, interaction) returns `messages` itself, so callers can tell nothing changed by
 * reference instead of keeping their own list of such events.
 */
export function applyAgentTransportEvent<Messages extends readonly UIMessage[]>(
  messages: Messages,
  event: AgentTransportEvent,
): Messages | UIMessage[] {
  const unchanged = () => messages

  return matchBy(event, 'type')
    .with('agent_start', 'agent_end', 'turn_start', 'turn_end', unchanged)
    .with('message_start', (value) => {
      if (value.role === 'assistant') {
        return ensureAssistantMessage(messages, value.messageId, value.timestamp)
      }
      const { userMessage } = value
      return value.role === 'user' && userMessage
        ? applyIncorporatedUserMessage(messages, { ...value, userMessage })
        : unchanged()
    })
    .with('message_update', (value) =>
      stampStartedMessage(messages, applyAssistantMessageEvent(messages, value), value),
    )
    .with('message_end', 'context_usage', unchanged)
    .with('tool_execution_start', (value) =>
      stampStartedMessage(messages, startToolExecution(messages, value), value),
    )
    .with('tool_execution_update', (value) =>
      stampStartedMessage(messages, updateToolExecution(messages, value), value),
    )
    .with('tool_execution_end', (value) =>
      stampStartedMessage(messages, finishToolExecution(messages, value), value),
    )
    .with(
      'queue_update',
      'compaction_start',
      'compaction_end',
      'auto_retry_start',
      'auto_retry_end',
      'agent_interaction_request',
      'agent_interaction_resolved',
      'custom',
      unchanged,
    )
    .exhaustive()
}
