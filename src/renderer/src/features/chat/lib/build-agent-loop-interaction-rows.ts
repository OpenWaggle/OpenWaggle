import {
  notificationCreatesDurableRecord,
  notificationResolutionCreatesDurableRecord,
} from '@shared/utils/agent-notification-durability'
import type { AgentInteractionEvent, AgentInteractionTranscriptItem } from './types-chat-row'

function shouldSkipRequest(
  event: Extract<AgentInteractionEvent, { type: 'agent_interaction_request' }>,
) {
  return (
    event.interaction.kind === 'notify' &&
    !notificationCreatesDurableRecord(event.interaction.level)
  )
}

function shouldSkipResolution(
  event: Extract<AgentInteractionEvent, { type: 'agent_interaction_resolved' }>,
) {
  return event.kind === 'notify' && !notificationResolutionCreatesDurableRecord()
}

/** One transcript item per durable interaction, its resolution joined to its request, in order. */
export function buildInteractionTranscriptItems(
  interactionEvents: readonly AgentInteractionEvent[],
): AgentInteractionTranscriptItem[] {
  const itemsByInteractionId = new Map<string, AgentInteractionTranscriptItem>()
  const orderedInteractionIds: string[] = []

  for (const event of interactionEvents) {
    if (event.type === 'agent_interaction_request') {
      if (shouldSkipRequest(event)) {
        continue
      }

      const interactionId = event.interaction.interactionId
      if (!itemsByInteractionId.has(interactionId)) {
        orderedInteractionIds.push(interactionId)
      }
      itemsByInteractionId.set(interactionId, {
        request: event,
        resolution: itemsByInteractionId.get(interactionId)?.resolution,
      })
      continue
    }

    if (shouldSkipResolution(event)) {
      continue
    }

    const item = itemsByInteractionId.get(event.interactionId)
    if (item) {
      itemsByInteractionId.set(event.interactionId, { ...item, resolution: event })
    }
  }

  return orderedInteractionIds.flatMap((interactionId) => {
    const item = itemsByInteractionId.get(interactionId)
    return item ? [item] : []
  })
}
