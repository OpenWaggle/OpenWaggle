import type { AgentTransportEvent } from '@shared/types/stream'

export function isTerminalTransportEvent(event: AgentTransportEvent) {
  if (event.type !== 'agent_end') {
    return false
  }

  return event.reason !== 'toolUse'
}
