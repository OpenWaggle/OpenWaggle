import type { SubAgentEventPayload, TeamEventPayload } from '@shared/types/sub-agent'
import { broadcastToWindows } from '../utils/broadcast'

export function emitSubAgentEvent(payload: SubAgentEventPayload): void {
  broadcastToWindows('sub-agent:event', payload)
}

export function emitTeamEvent(payload: TeamEventPayload): void {
  broadcastToWindows('team:event', payload)
}
