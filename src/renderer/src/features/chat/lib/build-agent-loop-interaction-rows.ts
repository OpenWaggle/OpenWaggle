import {
  notificationCreatesDurableRecord,
  notificationResolutionCreatesDurableRecord,
} from '@shared/utils/agent-notification-durability'
import type {
  AgentInteractionEvent,
  AgentInteractionTranscriptItem,
  ChatRow,
} from './types-chat-row'

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

export function appendInteractionEventRows(
  rows: ChatRow[],
  interactionEvents: readonly AgentInteractionEvent[],
) {
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

  for (const interactionId of orderedInteractionIds) {
    const item = itemsByInteractionId.get(interactionId)
    if (item) {
      rows.push({ type: 'agent-loop-interaction', item })
    }
  }
}
