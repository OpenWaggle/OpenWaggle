import type { SessionTranscriptEntry, SessionWorkspace } from '@shared/types/session'
import type { AgentTransportCustomEvent } from '@shared/types/stream'
import {
  type AgentLoopTranscriptNode,
  isAgentLoopTranscriptNode,
  readAgentLoopEventFromNode,
} from './agent-loop-transcript-event-parser'
import type { AgentInteractionEvent } from './types-chat-row'

interface AgentLoopTranscriptEvents {
  readonly customMessages: readonly AgentTransportCustomEvent[]
  readonly interactionEvents: readonly AgentInteractionEvent[]
}

function readAgentLoopEventsFromNodes(
  nodes: readonly AgentLoopTranscriptNode[],
): AgentLoopTranscriptEvents {
  const customMessages: AgentTransportCustomEvent[] = []
  const interactionEvents: AgentInteractionEvent[] = []

  for (const node of nodes) {
    const event = readAgentLoopEventFromNode(node)
    if (event === null) {
      continue
    }

    if (event.type === 'custom') {
      customMessages.push(event)
    } else {
      interactionEvents.push(event)
    }
  }

  return { customMessages, interactionEvents }
}

export function readAgentLoopEventsFromTranscriptPath(
  transcriptPath: readonly SessionTranscriptEntry[],
): AgentLoopTranscriptEvents {
  return readAgentLoopEventsFromNodes(transcriptPath.map((entry) => entry.node))
}

function compareWorkspaceNodes(left: AgentLoopTranscriptNode, right: AgentLoopTranscriptNode) {
  return left.timestampMs - right.timestampMs || left.createdOrder - right.createdOrder
}

function hasTranscriptPathAnchor(input: {
  readonly node: AgentLoopTranscriptNode
  readonly nodeById: ReadonlyMap<string, AgentLoopTranscriptNode>
  readonly transcriptNodeIds: ReadonlySet<string>
}) {
  const visited = new Set<string>()
  let parentId = input.node.parentId

  while (parentId) {
    if (input.transcriptNodeIds.has(parentId)) {
      return true
    }
    if (visited.has(parentId)) {
      return false
    }
    visited.add(parentId)

    const parent = input.nodeById.get(parentId)
    if (!parent || !isAgentLoopTranscriptNode(parent)) {
      return false
    }
    parentId = parent.parentId
  }

  return false
}

export function readAgentLoopEventsFromWorkspace(
  workspace: SessionWorkspace,
): AgentLoopTranscriptEvents {
  const transcriptNodeIds = new Set(workspace.transcriptPath.map((entry) => String(entry.node.id)))
  const nodeById = new Map(workspace.tree.nodes.map((node) => [String(node.id), node]))
  const visibleNodes = workspace.tree.nodes.filter(
    (node) =>
      transcriptNodeIds.has(String(node.id)) ||
      hasTranscriptPathAnchor({
        node,
        nodeById,
        transcriptNodeIds,
      }),
  )

  return readAgentLoopEventsFromNodes([...visibleNodes].sort(compareWorkspaceNodes))
}

function customMessageKey(event: AgentTransportCustomEvent) {
  return `${event.timestamp}:${event.name}:${JSON.stringify(event.value ?? null)}`
}

function interactionEventKey(event: AgentInteractionEvent) {
  return event.type === 'agent_interaction_request'
    ? `request:${String(event.interaction.sessionId)}:${event.interaction.runId}:${
        event.interaction.interactionId
      }`
    : `resolved:${event.runId}:${event.interactionId}:${event.status}`
}

export function mergeCustomMessages(
  persisted: readonly AgentTransportCustomEvent[],
  live: readonly AgentTransportCustomEvent[],
) {
  const eventsByKey = new Map(persisted.map((event) => [customMessageKey(event), event]))
  for (const event of live) {
    eventsByKey.set(customMessageKey(event), event)
  }
  return [...eventsByKey.values()].sort((left, right) => left.timestamp - right.timestamp)
}

export function mergeInteractionEvents(
  persisted: readonly AgentInteractionEvent[],
  live: readonly AgentInteractionEvent[],
) {
  const eventsByKey = new Map(persisted.map((event) => [interactionEventKey(event), event]))
  for (const event of live) {
    eventsByKey.set(interactionEventKey(event), event)
  }
  return [...eventsByKey.values()].sort((left, right) => left.timestamp - right.timestamp)
}
