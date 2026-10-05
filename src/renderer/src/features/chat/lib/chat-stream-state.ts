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
      if (value.role === 'assistant') return ensureAssistantMessage(messages, value.messageId)
      const { userMessage } = value
      return value.role === 'user' && userMessage
        ? applyIncorporatedUserMessage(messages, { ...value, userMessage })
        : unchanged()
    })
    .with('message_update', (value) => applyAssistantMessageEvent(messages, value))
    .with('message_end', 'context_usage', unchanged)
    .with('tool_execution_start', (value) => startToolExecution(messages, value))
    .with('tool_execution_update', (value) => updateToolExecution(messages, value))
    .with('tool_execution_end', (value) => finishToolExecution(messages, value))
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
