import type { AgentTransportEvent } from '@shared/types/stream'

export function isTerminalTransportEvent(event: AgentTransportEvent): boolean {
  if (event.type !== 'agent_end') {
    return false
  }

  return event.reason !== 'toolUse'
}
