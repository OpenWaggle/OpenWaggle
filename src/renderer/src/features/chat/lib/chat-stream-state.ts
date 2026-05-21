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

export function applyAgentTransportEvent(
  messages: readonly UIMessage[],
  event: AgentTransportEvent,
) {
  const cloneMessages = () => messages.slice()

  return matchBy(event, 'type')
    .with('agent_start', 'agent_end', 'turn_start', 'turn_end', cloneMessages)
    .with('message_start', (value) =>
      value.role === 'assistant'
        ? ensureAssistantMessage(messages, value.messageId)
        : cloneMessages(),
    )
    .with('message_update', (value) => applyAssistantMessageEvent(messages, value))
    .with('message_end', cloneMessages)
    .with('tool_execution_start', (value) => startToolExecution(messages, value))
    .with('tool_execution_update', (value) => updateToolExecution(messages, value))
    .with('tool_execution_end', (value) => finishToolExecution(messages, value))
    .with(
      'queue_update',
      'compaction_start',
      'compaction_end',
      'auto_retry_start',
      'auto_retry_end',
      'custom',
      cloneMessages,
    )
    .exhaustive()
}
