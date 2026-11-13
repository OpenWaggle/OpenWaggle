import type { AgentTransportEvent } from '@shared/types/stream'

export function isTerminalTransportEvent(event: AgentTransportEvent): boolean {
  if (event.type !== 'agent_end') {
    return false
  }

  return event.reason !== 'toolUse'
}

/**
 * Whether the event is a Run streaming on: a prompt or answer it starts, an answer it streams, or
 * a tool it starts. Only an active Run sends these, so they tell the renderer a Run is active even
 * when its `agent_start` never reached it. What a Run sends as it ends (`message_end`,
 * `context_usage`, a tool's end) does not: it can arrive after the Run's last `agent_end`. Nor
 * does a custom message shown as a user row (a Waggle request, a Hive wake), which Pi can flush
 * after it, or a tool's update, which Pi relays even after the tool returned.
 */
export function isRunStreamingEvent(event: AgentTransportEvent): boolean {
  if (event.type === 'message_start') {
    const custom = event.userMessage?.hiveWake ?? event.userMessage?.waggleInvocation
    return event.role === 'assistant' || (event.role === 'user' && custom === undefined)
  }
  return event.type === 'message_update' || event.type === 'tool_execution_start'
}
