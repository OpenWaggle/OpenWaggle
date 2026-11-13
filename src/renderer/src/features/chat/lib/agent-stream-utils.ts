import type { AgentTransportEvent } from '@shared/types/stream'

export function isTerminalTransportEvent(event: AgentTransportEvent): boolean {
  if (event.type !== 'agent_end') {
    return false
  }

  return event.reason !== 'toolUse'
}

/**
 * Whether the event is a Run streaming on: a message it starts or streams, or a tool it runs. Only
 * an active Run sends these, so they tell the renderer a Run is active even when its `agent_start`
 * never reached it. What a Run sends as it ends (`message_end`, `context_usage`, a tool's end)
 * does not: it can arrive after the Run's last `agent_end`.
 */
export function isRunStreamingEvent(event: AgentTransportEvent): boolean {
  return (
    event.type === 'message_start' ||
    event.type === 'message_update' ||
    event.type === 'tool_execution_start' ||
    event.type === 'tool_execution_update'
  )
}
