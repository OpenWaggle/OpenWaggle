import type { AgentTransportEvent } from '@shared/types/stream'

export function emitEvent(
  onEvent: (event: AgentTransportEvent) => void,
  event: AgentTransportEvent,
) {
  onEvent(event)
}
